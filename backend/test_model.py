import subprocess, json, sys

tests = [
    ("compare",  {"mode": "compare"}),
    ("explain",  {"mode": "explain", "sales": 580, "inventory": 1000, "price": 85000, "month": 9, "lead_time": 14}),
    ("quality",  {"mode": "quality"}),
    ("batch",    {
        "mode": "batch",
        "items": [
            {"sales": 580, "inventory": 1000, "price": 85000, "month": 9, "lead_time": 14},
            {"sales": 650, "inventory": 800, "price": 2600, "month": 10, "lead_time": 5},
        ],
    }),
    ("scenario", {
        "mode": "scenario",
        "sales": 580, "inventory": 1000, "price": 85000, "month": 9, "lead_time": 14,
        "scenarios": [
            {"id": "sc1", "name": "Demand Spike +20%", "sales_change_pct": 20},
            {"id": "sc2", "name": "Supplier Delay",   "lead_time_value": 21}
        ]
    }),
    ("full",     {"mode": "full", "sales": 580, "inventory": 1000, "price": 85000, "month": 9, "lead_time": 14}),
]

all_pass = True
batch_forecasts = None
full_forecast = None
for name, inp in tests:
    r = subprocess.run(
        ["py", "rf_model.py", json.dumps(inp)],
        capture_output=True, text=True, cwd="."
    )
    out = r.stdout.strip()
    err = r.stderr.strip()
    try:
        parsed = json.loads(out) if out else {}
    except Exception as e:
        print(f"FAIL {name}: JSON parse error — {e}\nraw: {out[:200]}")
        all_pass = False
        continue
    if "error" in parsed:
        print(f"FAIL {name}: {parsed['error']}")
        all_pass = False
    elif name == "batch" and (
        len(parsed.get("forecasts", [])) != 2
        or any("predicted_demand" not in forecast for forecast in parsed["forecasts"])
    ):
        print("FAIL batch: expected two complete forecast results")
        all_pass = False
    else:
        if name == "batch":
            batch_forecasts = parsed["forecasts"]
        elif name == "full":
            full_forecast = parsed
        keys = list(parsed.keys())[:5]
        print(f"OK   {name}: {keys}")

if batch_forecasts and full_forecast and batch_forecasts[0]["predicted_demand"] != full_forecast["predicted_demand"]:
    print("FAIL batch: first result differs from the equivalent full forecast")
    all_pass = False

# Print detailed compare output
print("\n--- COMPARE DETAIL ---")
r = subprocess.run(["py", "rf_model.py", json.dumps({"mode": "compare"})],
                   capture_output=True, text=True, cwd=".")
parsed = json.loads(r.stdout)
print(f"Best model: {parsed['best_model']}")
for m in parsed["models"]:
    print(f"  {m['model']:20s}  MAE={m['mae']:6.1f}  RMSE={m['rmse']:6.1f}  MAPE={m['mape']}%  R2={m['r2']}")

print("\n--- FORECAST DETAIL ---")
r = subprocess.run(["py", "rf_model.py", json.dumps({
    "mode": "forecast", "sales": 580, "inventory": 1000, "price": 85000, "month": 9, "lead_time": 14
})], capture_output=True, text=True, cwd=".")
parsed = json.loads(r.stdout)
print(f"Predicted: {parsed['predicted_demand']}  Interval: [{parsed['prediction_interval']['lower']}, {parsed['prediction_interval']['upper']}]")
print(f"Metrics: MAE={parsed['model_metrics']['mae']}  MAPE={parsed['model_metrics']['mape']}%")
print(f"Top contribution: {parsed['feature_contributions'][0]}")

if all_pass:
    print("\nALL TESTS PASSED")
else:
    print("\nSOME TESTS FAILED")
    sys.exit(1)
