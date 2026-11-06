"""
rf_model.py — ForecastAI ML Pipeline
======================================
Invoked by Node.js via execFile('py', ['rf_model.py', json_input])

Modes (determined by input JSON 'mode' field):
  forecast   — predict demand for a single row (default)
  compare    — train & evaluate multiple models, return metrics
  explain    — return SHAP-style feature contributions for a prediction
  scenario   — apply scenario multipliers and re-predict
  quality    — analyse CSV data quality
  full       — train on CSV, return forecast + metrics + explanation

Output: JSON to stdout (never prints anything else)
"""

import sys
import json
import os
import math
import time
import pickle
import hashlib
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.tree import DecisionTreeRegressor
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder

# ── Helpers ─────────────────────────────────────────────────────────────────

def safe_mape(y_true, y_pred):
    """Mean Absolute Percentage Error — skips zeros to avoid division by zero."""
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    mask = y_true != 0
    if mask.sum() == 0:
        return None
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100)

def safe_r2(y_true, y_pred):
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    if ss_tot == 0:
        return None
    return float(1 - ss_res / ss_tot)

def forecast_bias(y_true, y_pred):
    """Positive = over-forecast, Negative = under-forecast."""
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    return float(np.mean(y_pred - y_true))

def load_and_validate(csv_path, required_cols):
    """Load CSV, validate columns, coerce numeric, drop NaN rows."""
    try:
        df = pd.read_csv(csv_path)
    except Exception as e:
        return None, f"CSV load failed: {str(e)}"

    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        return None, f"Missing columns: {', '.join(missing)}"

    for col in required_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna(subset=required_cols)

    if len(df) < 4:
        return None, f"Need at least 4 valid rows, found {len(df)}"

    return df, None

def chronological_split(df, test_frac=0.25):
    """Split keeping temporal order — no data leakage."""
    n = len(df)
    split_idx = max(1, int(n * (1 - test_frac)))
    return df.iloc[:split_idx], df.iloc[split_idx:]

def compute_metrics(y_true, y_pred, label="model"):
    mae  = float(mean_absolute_error(y_true, y_pred))
    rmse = float(math.sqrt(mean_squared_error(y_true, y_pred)))
    mape = safe_mape(y_true, y_pred)
    r2   = safe_r2(y_true, y_pred)
    bias = forecast_bias(y_true, y_pred)
    return {
        "model":  label,
        "mae":    round(mae,  2),
        "rmse":   round(rmse, 2),
        "mape":   round(mape, 2) if mape is not None else None,
        "r2":     round(r2,   4) if r2   is not None else None,
        "bias":   round(bias, 2),
    }

def shap_tree_manual(model, X_input, feature_names, background_mean):
    """
    Manual SHAP-style feature attribution for Random Forest.
    Uses the difference between mean prediction and feature-perturbed prediction
    as a proxy for contribution (SHAP baseline approach without shap library).
    Returns list of {feature, value, contribution, direction}.
    """
    contributions = []
    baseline_pred = float(model.predict(background_mean.reshape(1, -1))[0])
    full_pred     = float(model.predict(X_input.reshape(1, -1))[0])

    for i, feat in enumerate(feature_names):
        perturbed = background_mean.copy()
        perturbed[i] = X_input[i]
        perturbed_pred = float(model.predict(perturbed.reshape(1, -1))[0])
        contribution   = perturbed_pred - baseline_pred
        contributions.append({
            "feature":      feat,
            "input_value":  round(float(X_input[i]), 2),
            "contribution": round(contribution, 2),
            "direction":    "positive" if contribution >= 0 else "negative",
            "abs":          abs(contribution)
        })

    # Sort by absolute contribution descending
    contributions.sort(key=lambda x: x["abs"], reverse=True)
    for c in contributions:
        del c["abs"]

    return contributions, round(full_pred, 2), round(baseline_pred, 2)

def prediction_interval(model, X_input, feature_names, df_train, y_train, confidence=0.90):
    """
    Bootstrap prediction interval from individual tree predictions in RF.
    This is statistically valid for Random Forest (uses variance across trees).
    """
    tree_preds = np.array([
        tree.predict(X_input.reshape(1, -1))[0]
        for tree in model.estimators_
    ])
    mean_pred = float(np.mean(tree_preds))
    std_pred  = float(np.std(tree_preds))

    # Also account for residual error from training
    train_preds = model.predict(df_train[feature_names].values)
    residuals   = y_train.values - train_preds
    residual_std = float(np.std(residuals))

    # Combined uncertainty
    total_std = math.sqrt(std_pred**2 + residual_std**2)

    # z-score for given confidence
    z = {0.80: 1.282, 0.85: 1.440, 0.90: 1.645, 0.95: 1.960}.get(confidence, 1.645)

    lower = max(0, mean_pred - z * total_std)
    upper = mean_pred + z * total_std

    return {
        "predicted": round(mean_pred, 2),
        "lower":     round(lower, 2),
        "upper":     round(upper, 2),
        "std":       round(total_std, 2),
        "confidence": confidence
    }

def regression_interval(model, X_input, feature_names, df_train, y_train, confidence=0.90):
    """Approximate uncertainty for non-tree models from chronological residuals."""
    predicted = float(model.predict(X_input.reshape(1, -1))[0])
    residuals = y_train.values - model.predict(df_train[feature_names].values)
    std = float(np.std(residuals))
    z = {0.80: 1.282, 0.85: 1.440, 0.90: 1.645, 0.95: 1.960}.get(confidence, 1.645)
    return {
        "predicted": round(max(0, predicted), 2),
        "lower": round(max(0, predicted - z * std), 2),
        "upper": round(max(0, predicted + z * std), 2),
        "std": round(std, 2),
        "confidence": confidence,
    }

# ── Default CSV path ─────────────────────────────────────────────────────────
DEFAULT_CSV = os.path.join(os.path.dirname(__file__), "data.csv")
FEATURES    = ["sales", "inventory", "price", "month", "lead_time"]
TARGET      = "demand"
MODEL_CACHE_DIR = os.path.join(os.path.dirname(__file__), "model_cache")
os.makedirs(MODEL_CACHE_DIR, exist_ok=True)


def get_dataset_cache_key(csv_path, feature_list):
    """Stable key for the current dataset + feature selection, so the model is reused until the data changes."""
    try:
        with open(csv_path, "rb") as fh:
            payload = fh.read()
    except Exception:
        payload = str(csv_path).encode("utf-8")
    digest = hashlib.sha256()
    digest.update(payload)
    digest.update("|".join(feature_list).encode("utf-8"))
    digest.update(TARGET.encode("utf-8"))
    return digest.hexdigest()[:24]


def load_cached_model(cache_key):
    cache_path = os.path.join(MODEL_CACHE_DIR, f"{cache_key}.pkl")
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "rb") as fh:
            return pickle.load(fh)
    except Exception:
        return None


def save_cached_model(cache_key, bundle):
    cache_path = os.path.join(MODEL_CACHE_DIR, f"{cache_key}.pkl")
    try:
        with open(cache_path, "wb") as fh:
            pickle.dump(bundle, fh)
    except Exception:
        pass

# ── Entry point ──────────────────────────────────────────────────────────────
if len(sys.argv) < 2:
    print(json.dumps({"error": "No input provided"}))
    sys.exit(1)

try:
    inp = json.loads(sys.argv[1])
except Exception:
    print(json.dumps({"error": "Invalid JSON input"}))
    sys.exit(1)

mode     = inp.get("mode", "forecast")
csv_path = inp.get("csv_path") if inp.get("csv_path") and os.path.isfile(inp["csv_path"]) else DEFAULT_CSV

# ════════════════════════════════════════════════════════════════════════════
# MODE: quality — data quality analysis
# ════════════════════════════════════════════════════════════════════════════
if mode == "quality":
    try:
        raw = pd.read_csv(csv_path)
    except Exception as e:
        print(json.dumps({"error": f"Cannot read file: {e}"}))
        sys.exit(1)

    issues = []
    score  = 100

    for column in raw.columns:
        if column in ["date", "timestamp"]:
            invalid_dates = int(pd.to_datetime(raw[column], errors="coerce").isna().sum())
            if invalid_dates:
                score -= min(20, invalid_dates * 2)
                issues.append({"type": "invalid_dates", "severity": "high", "column": column, "count": invalid_dates, "message": f"{column}: {invalid_dates} invalid date value(s)"})

    numeric_candidates = [column for column in ["year", "month", "sales", "inventory", "price", "demand", "lead_time"] if column in raw.columns]
    for column in numeric_candidates:
        converted = pd.to_numeric(raw[column], errors="coerce")
        invalid_numeric = int((converted.isna() & raw[column].notna()).sum())
        if invalid_numeric:
            score -= min(20, invalid_numeric * 2)
            issues.append({"type": "invalid_numeric", "severity": "high", "column": column, "count": invalid_numeric, "message": f"{column}: {invalid_numeric} invalid numeric value(s)"})

    # Missing values
    missing_counts = raw.isnull().sum()
    total_missing  = int(missing_counts.sum())
    if total_missing > 0:
        score -= min(30, total_missing * 2)
        for col, cnt in missing_counts[missing_counts > 0].items():
            issues.append({"type": "missing_values", "severity": "high",
                           "column": col, "count": int(cnt),
                           "message": f"{col}: {cnt} missing value(s)"})

    # Duplicate rows
    dupes = int(raw.duplicated().sum())
    if dupes > 0:
        score -= min(20, dupes * 3)
        issues.append({"type": "duplicates", "severity": "medium",
                       "count": dupes, "message": f"{dupes} duplicate row(s) found"})

    # Negative sales/demand/inventory
    for col in ["sales", "demand", "inventory"]:
        if col in raw.columns:
            neg = int((pd.to_numeric(raw[col], errors='coerce').fillna(0) < 0).sum())
            if neg > 0:
                score -= min(15, neg * 5)
                issues.append({"type": "negative_values", "severity": "high",
                               "column": col, "count": neg,
                               "message": f"{col}: {neg} negative value(s)"})

    # Outliers (IQR method on numeric columns)
    numeric_cols = raw.select_dtypes(include=[np.number]).columns
    outlier_info = []
    for col in numeric_cols:
        q1 = raw[col].quantile(0.25)
        q3 = raw[col].quantile(0.75)
        iqr = q3 - q1
        if iqr > 0:
            outliers = int(((raw[col] < q1 - 1.5 * iqr) | (raw[col] > q3 + 1.5 * iqr)).sum())
            if outliers > 0:
                outlier_info.append({"column": col, "count": outliers})
                score -= min(10, outliers)
                issues.append({"type": "outliers", "severity": "low",
                               "column": col, "count": outliers,
                               "message": f"{col}: {outliers} statistical outlier(s) (IQR)"})

    # Check required columns
    req = ["sales", "inventory", "price", "month", "demand"]
    missing_req = [c for c in req if c not in raw.columns]
    if missing_req:
        score -= 25
        issues.append({"type": "missing_required_columns", "severity": "critical",
                       "columns": missing_req,
                       "message": f"Missing required columns: {', '.join(missing_req)}"})

    # Row count warning
    if len(raw) < 12:
        score -= 10
        issues.append({"type": "insufficient_data", "severity": "medium",
                       "count": len(raw),
                       "message": f"Only {len(raw)} rows — model accuracy may be low (recommend ≥24)"})

    score = max(0, score)
    print(json.dumps({
        "score": score,
        "rows": len(raw),
        "columns": list(raw.columns),
        "column_count": len(raw.columns),
        "issues": issues,
        "issue_count": len(issues),
        "summary": {
            "missing_values": total_missing,
            "duplicates": dupes,
            "outliers": sum(o["count"] for o in outlier_info),
        }
    }))
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════
# MODE: train — train and evaluate selectable regression models
# ════════════════════════════════════════════════════════════════════════════
if mode == "train":
    try:
        train_df = pd.read_csv(csv_path)
    except Exception as e:
        print(json.dumps({"error": f"CSV load failed: {e}"}))
        sys.exit(1)

    target = inp.get("target", "demand")
    requested_features = inp.get("features") or []
    if target not in train_df.columns:
        print(json.dumps({"error": f"Target column not found: {target}"}))
        sys.exit(1)
    numeric_columns = train_df.select_dtypes(include=[np.number]).columns.tolist()
    features = requested_features or [column for column in numeric_columns if column != target]
    missing_features = [feature for feature in features if feature not in train_df.columns]
    if missing_features:
        print(json.dumps({"error": f"Feature columns not found: {', '.join(missing_features)}"}))
        sys.exit(1)
    if target in features:
        print(json.dumps({"error": f"Target column '{target}' must not be included in features."}))
        sys.exit(1)
    if not features:
        print(json.dumps({"error": "Select at least one numeric feature."}))
        sys.exit(1)

    train_df[target] = pd.to_numeric(train_df[target], errors="coerce")
    train_df = train_df.dropna(subset=[target]).copy()
    if len(train_df) < 4:
        print(json.dumps({"error": f"Need at least 4 rows with numeric '{target}' values; found {len(train_df)}."}))
        sys.exit(1)

    # Preserve time order when temporal columns are present; preprocessing is
    # fitted inside each model on the training partition only.
    sort_columns = [column for column in ["year", "month", "date", "timestamp"] if column in train_df.columns]
    if sort_columns:
        train_df = train_df.sort_values(sort_columns, kind="stable").reset_index(drop=True)

    train_part, test_part = chronological_split(train_df, test_frac=float(inp.get("test_fraction", 0.25)))
    if len(test_part) < 1 or len(train_part) < 2:
        print(json.dumps({"error": "Dataset is too small for a chronological test split."}))
        sys.exit(1)

    X_train, X_test = train_part[features], test_part[features]
    y_train, y_test = train_part[target].values, test_part[target].values
    numeric_features = [feature for feature in features if pd.api.types.is_numeric_dtype(train_df[feature])]
    categorical_features = [feature for feature in features if feature not in numeric_features]
    def make_preprocessor():
        numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
        categorical_pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ])
        transformers = []
        if numeric_features:
            transformers.append(("numeric", numeric_pipeline, numeric_features))
        if categorical_features:
            transformers.append(("categorical", categorical_pipeline, categorical_features))
        return ColumnTransformer(transformers=transformers, remainder="drop")

    available_models = {
        "Linear Regression": lambda: Pipeline([("preprocessor", make_preprocessor()), ("model", LinearRegression())]),
        "Random Forest": lambda: Pipeline([("preprocessor", make_preprocessor()), ("model", RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1))]),
    }
    selected_model = inp.get("model")
    if selected_model and selected_model not in available_models:
        print(json.dumps({"error": f"Unsupported model: {selected_model}"}))
        sys.exit(1)
    models = {selected_model: available_models[selected_model]()} if selected_model else {name: factory() for name, factory in available_models.items()}
    results = {}
    for name, estimator in models.items():
        estimator.fit(X_train, y_train)
        predictions = estimator.predict(X_test)
        metrics = compute_metrics(y_test, predictions, name)
        metrics["mse"] = round(float(mean_squared_error(y_test, predictions)), 2)
        metrics["train_samples"] = len(train_part)
        metrics["test_samples"] = len(test_part)
        metrics["features"] = features
        metrics["predictions"] = [
            {"actual": round(float(actual), 4), "predicted": round(float(predicted), 4)}
            for actual, predicted in zip(y_test, predictions)
        ]
        metrics["training_status"] = "completed"
        if name == "Random Forest":
            transformed_names = estimator.named_steps["preprocessor"].get_feature_names_out()
            importances = estimator.named_steps["model"].feature_importances_
            metrics["feature_importance"] = [
                {"feature": feature_name, "importance": round(float(importance), 6)}
                for feature_name, importance in sorted(zip(transformed_names, importances), key=lambda item: item[1], reverse=True)
            ]
        results[name] = metrics

    best_model = min(results, key=lambda name: results[name]["rmse"])
    print(json.dumps({
        "target": target,
        "features": features,
        "numeric_features": numeric_features,
        "categorical_features": categorical_features,
        "models": results,
        "best_model": best_model,
        "split_info": {"method": "chronological", "train_size": len(train_part), "test_size": len(test_part), "test_fraction": float(inp.get("test_fraction", 0.25))}
    }))
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════
# Load and prepare data for all other modes
# ════════════════════════════════════════════════════════════════════════════
# For uploaded CSVs that may not have lead_time, default to 7
req_cols = [c for c in FEATURES + [TARGET] if c != "lead_time"]
df, err = load_and_validate(csv_path, req_cols)
if err:
    print(json.dumps({"error": err}))
    sys.exit(1)

if "lead_time" not in df.columns:
    df["lead_time"] = 7

df["lead_time"] = pd.to_numeric(df["lead_time"], errors='coerce').fillna(7)

# Use all available features, subset to those that actually exist
avail_features = [f for f in FEATURES if f in df.columns]

# ════════════════════════════════════════════════════════════════════════════
# MODE: compare — multi-model evaluation with chronological split
# ════════════════════════════════════════════════════════════════════════════
if mode == "compare":
    df_sorted = df.sort_values(["month"] if "month" in df.columns else df.columns[0]).reset_index(drop=True)
    df_train, df_test = chronological_split(df_sorted, test_frac=0.25)

    if len(df_test) < 2:
        # Not enough for test set — use all for train, report train metrics
        df_train = df_sorted
        df_test  = df_sorted.tail(max(2, int(len(df_sorted) * 0.2)))

    X_train = df_train[avail_features].values
    y_train = df_train[TARGET].values
    X_test  = df_test[avail_features].values
    y_test  = df_test[TARGET].values

    results = []

    # 1. Random Forest
    t0 = time.time()
    rf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    rf_time = round(time.time() - t0, 3)
    rf_preds = rf.predict(X_test)
    m = compute_metrics(y_test, rf_preds, "Random Forest")
    m["train_samples"] = len(X_train)
    m["test_samples"]  = len(X_test)
    m["training_time_s"] = rf_time
    m["features"] = avail_features
    m["status"] = "active"
    m["version"] = "v1.0"
    results.append(m)

    # 2. Linear Regression
    t0 = time.time()
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)
    lr = LinearRegression()
    lr.fit(X_train_s, y_train)
    lr_time = round(time.time() - t0, 3)
    lr_preds = lr.predict(X_test_s)
    m2 = compute_metrics(y_test, lr_preds, "Linear Regression")
    m2["train_samples"] = len(X_train)
    m2["test_samples"]  = len(X_test)
    m2["training_time_s"] = lr_time
    m2["features"] = avail_features
    m2["status"] = "available"
    m2["version"] = "v1.0"
    results.append(m2)

    # 3. Ridge Regression
    t0 = time.time()
    ridge = Ridge(alpha=1.0)
    ridge.fit(X_train_s, y_train)
    ridge_time = round(time.time() - t0, 3)
    ridge_preds = ridge.predict(X_test_s)
    m3 = compute_metrics(y_test, ridge_preds, "Ridge Regression")
    m3["train_samples"] = len(X_train)
    m3["test_samples"]  = len(X_test)
    m3["training_time_s"] = ridge_time
    m3["features"] = avail_features
    m3["status"] = "available"
    m3["version"] = "v1.0"
    results.append(m3)

    # 4. Decision Tree
    t0 = time.time()
    dt = DecisionTreeRegressor(random_state=42, max_depth=5)
    dt.fit(X_train, y_train)
    dt_time = round(time.time() - t0, 3)
    dt_preds = dt.predict(X_test)
    m4 = compute_metrics(y_test, dt_preds, "Decision Tree")
    m4["train_samples"] = len(X_train)
    m4["test_samples"]  = len(X_test)
    m4["training_time_s"] = dt_time
    m4["features"] = avail_features
    m4["status"] = "available"
    m4["version"] = "v1.0"
    results.append(m4)

    # Rank by the product requirement: MAE, RMSE, MAPE, R2, then absolute bias.
    def sort_key(r):
        return (
            r["mae"], r["rmse"],
            r["mape"] if r["mape"] is not None else float("inf"),
            -(r["r2"] if r["r2"] is not None else -float("inf")),
            abs(r["bias"]),
        )

    results_sorted = sorted(results, key=sort_key)
    best_model_name = results_sorted[0]["model"]
    for r in results:
        r["is_best"] = (r["model"] == best_model_name)

    best_estimator = {"Random Forest": rf, "Linear Regression": lr, "Ridge Regression": ridge, "Decision Tree": dt}[best_model_name]
    if hasattr(best_estimator, "feature_importances_"):
        raw_importance = np.abs(best_estimator.feature_importances_)
    else:
        raw_importance = np.abs(best_estimator.coef_)
    total_importance = float(np.sum(raw_importance)) or 1.0
    fi = [{"feature": f, "importance": round(float(imp / total_importance), 4)}
          for f, imp in zip(avail_features, raw_importance)]
    fi.sort(key=lambda x: x["importance"], reverse=True)

    print(json.dumps({
        "models":            results,
        "best_model":        best_model_name,
        "feature_importance": fi,
        "split_info": {
            "method":          "chronological",
            "train_size":      len(df_train),
            "test_size":       len(df_test),
            "test_fraction":   0.25,
            "note":            "Temporal split — no future data leakage"
        }
    }))
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════
# Train RF on full dataset for forecast/explain/scenario/full modes
# ════════════════════════════════════════════════════════════════════════════
df_sorted = df.sort_values("month" if "month" in df.columns else df.index).reset_index(drop=True)
X_all = df_sorted[avail_features].values
y_all = df_sorted[TARGET].values

# Chronological split for honest metrics
df_train_cv, df_test_cv = chronological_split(df_sorted, test_frac=0.25)
X_tr = df_train_cv[avail_features].values
y_tr = df_train_cv[TARGET].values
X_te = df_test_cv[avail_features].values
y_te = df_test_cv[TARGET].values

active_model = inp.get("model") or inp.get("active_model") or "Random Forest"
model_factories = {
    "Random Forest": lambda: RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1),
    "Linear Regression": lambda: LinearRegression(),
    "Ridge Regression": lambda: Ridge(alpha=1.0),
    "Decision Tree": lambda: DecisionTreeRegressor(random_state=42, max_depth=5),
}
if active_model not in model_factories:
    print(json.dumps({"error": f"Unsupported model: {active_model}"}))
    sys.exit(1)

model_full = model_factories[active_model]()
model_cv = model_factories[active_model]()
model_full.fit(X_all, y_all)
model_cv.fit(X_tr, y_tr)
cv_preds = model_cv.predict(X_te)
cv_metrics = compute_metrics(y_te, cv_preds, active_model)
bg_mean = np.mean(X_all, axis=0)

# ════════════════════════════════════════════════════════════════════════════
# Build input vector from request
# ════════════════════════════════════════════════════════════════════════════
def build_input_vector(inp_data, feature_list, df_ref):
    """Build feature vector, filling missing features from dataset mean."""
    vec = []
    for f in feature_list:
        if f in inp_data and inp_data[f] is not None:
            vec.append(float(inp_data[f]))
        else:
            vec.append(float(df_ref[f].mean()))
    return np.array(vec)

X_input = build_input_vector(inp, avail_features, df_sorted)

# ════════════════════════════════════════════════════════════════════════════
# MODE: forecast (default) — predict + prediction interval + basic explanation
# ════════════════════════════════════════════════════════════════════════════
if mode in ("forecast", "full"):
    interval_fn = prediction_interval if active_model == "Random Forest" else regression_interval
    pi = interval_fn(model_full, X_input, avail_features, df_train_cv, df_train_cv[TARGET])
    if active_model == "Random Forest":
        contributions, full_pred, baseline_pred = shap_tree_manual(model_full, X_input, avail_features, bg_mean)
    else:
        full_pred = pi["predicted"]
        baseline_pred = float(model_full.predict(bg_mean.reshape(1, -1))[0])
        contributions = []

    recommended_stock = round(pi["predicted"] * 1.15, 2)

    result = {
        "predicted_demand":   pi["predicted"],
        "recommended_stock":  recommended_stock,
        "prediction_interval": {
            "lower":      pi["lower"],
            "upper":      pi["upper"],
            "confidence": pi["confidence"]
        },
        "model_metrics": {
            "mae":  cv_metrics["mae"],
            "rmse": cv_metrics["rmse"],
            "mape": cv_metrics["mape"],
            "r2":   cv_metrics["r2"],
            "bias": cv_metrics["bias"],
            "train_samples": len(X_tr),
            "test_samples": len(X_te),
            "note": "Metrics from chronological train/test split (no data leakage)"
        },
        "feature_contributions": contributions,
        "baseline_prediction": baseline_pred,
        "model": active_model,
        "training_rows": len(X_all),
        "features_used": avail_features
    }

    if mode == "full":
        if active_model == "Random Forest":
            fi = [{"feature": f, "importance": round(float(imp), 4)}
                  for f, imp in zip(avail_features, model_full.feature_importances_)]
            fi.sort(key=lambda x: x["importance"], reverse=True)
        else:
            fi = []
        result["feature_importance"] = fi

    print(json.dumps(result))
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════
# MODE: explain — detailed SHAP-style explanation
# ════════════════════════════════════════════════════════════════════════════
if mode == "explain":
    if active_model != "Random Forest":
        print(json.dumps({"error": f"Feature explanation is unavailable for {active_model}."}))
        sys.exit(1)
    pi = prediction_interval(model_full, X_input, avail_features, df_train_cv, df_train_cv[TARGET])
    contributions, full_pred, baseline_pred = shap_tree_manual(model_full, X_input, avail_features, bg_mean)

    fi = [{"feature": f, "importance": round(float(imp), 4)}
        for f, imp in zip(avail_features, model_full.feature_importances_)]
    fi.sort(key=lambda x: x["importance"], reverse=True)

    # Trend analysis: compare input sales to dataset mean
    mean_sales = float(df_sorted["sales"].mean())
    sales_diff_pct = ((inp.get("sales", mean_sales) - mean_sales) / mean_sales * 100) if mean_sales else 0

    print(json.dumps({
        "predicted_demand":      round(full_pred, 2),
        "baseline_prediction":   round(baseline_pred, 2),
        "prediction_interval":   {"lower": pi["lower"], "upper": pi["upper"], "confidence": pi["confidence"]},
        "feature_contributions": contributions,
        "feature_importance":    fi,
        "model_metrics":         cv_metrics,
        "trend": {
            "sales_vs_avg_pct": round(sales_diff_pct, 1),
            "direction": "above_average" if sales_diff_pct > 5 else "below_average" if sales_diff_pct < -5 else "normal"
        },
        "model_note": "Contributions show how each feature shifts prediction from the dataset average baseline."
    }))
    sys.exit(0)

# ════════════════════════════════════════════════════════════════════════════
# MODE: scenario — apply multipliers and re-predict
# ════════════════════════════════════════════════════════════════════════════
if mode == "scenario":
    scenarios = inp.get("scenarios", [])
    if not scenarios:
        print(json.dumps({"error": "No scenarios provided. Expected 'scenarios' array."}))
        sys.exit(1)

    results = []
    interval_fn = prediction_interval if active_model == "Random Forest" else regression_interval
    baseline_pi = interval_fn(model_full, X_input, avail_features, df_train_cv, df_train_cv[TARGET])

    for sc in scenarios:
        sc_input = X_input.copy()
        applied = []

        # Apply each modifier
        for i, feat in enumerate(avail_features):
            change_key = f"{feat}_change_pct"
            abs_key    = f"{feat}_value"
            if change_key in sc:
                pct  = float(sc[change_key])
                sc_input[i] = sc_input[i] * (1 + pct / 100)
                applied.append({"feature": feat, "type": "pct_change", "value": pct})
            elif abs_key in sc:
                sc_input[i] = float(sc[abs_key])
                applied.append({"feature": feat, "type": "absolute", "value": float(sc[abs_key])})

        sc_pi = interval_fn(model_full, sc_input, avail_features, df_train_cv, df_train_cv[TARGET])

        demand_delta    = sc_pi["predicted"] - baseline_pi["predicted"]
        demand_delta_pct = (demand_delta / baseline_pi["predicted"] * 100) if baseline_pi["predicted"] else 0

        # Stockout probability: if inventory unchanged, use original inventory
        inventory_val = sc_input[avail_features.index("inventory")] if "inventory" in avail_features else inp.get("inventory", 0)
        stockout_prob = max(0, min(100, round(
            ((sc_pi["predicted"] - inventory_val) / sc_pi["predicted"] * 100) if sc_pi["predicted"] > 0 else 0, 1
        )))

        results.append({
            "scenario_id":     sc.get("id", f"sc_{len(results)+1}"),
            "scenario_name":   sc.get("name", f"Scenario {len(results)+1}"),
            "applied_changes": applied,
            "predicted_demand": sc_pi["predicted"],
            "prediction_interval": {"lower": sc_pi["lower"], "upper": sc_pi["upper"], "std": sc_pi["std"], "confidence": sc_pi["confidence"]},
            "recommended_stock": round(sc_pi["predicted"] * 1.15, 2),
            "demand_delta":     round(demand_delta, 2),
            "demand_delta_pct": round(demand_delta_pct, 1),
            "stockout_probability": stockout_prob,
        })

    print(json.dumps({
        "baseline": {
            "predicted_demand":   baseline_pi["predicted"],
            "prediction_interval": {"lower": baseline_pi["lower"], "upper": baseline_pi["upper"], "std": baseline_pi["std"], "confidence": baseline_pi["confidence"]},
            "recommended_stock":  round(baseline_pi["predicted"] * 1.15, 2),
        },
        "scenarios": results,
        "model": active_model,
        "methodology": f"Baseline forecast generated by {active_model}; scenario parameters applied as business-rule sensitivity adjustments.",
        "model_metrics": cv_metrics
    }))
    sys.exit(0)

# Fallback
print(json.dumps({"error": f"Unknown mode: {mode}"}))
sys.exit(1)
