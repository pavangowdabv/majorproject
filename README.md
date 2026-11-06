# ForecastAI — Explainable AI Decision Intelligence Platform

> **AI-assisted inventory decision support system for demand forecasting, risk analysis, and inventory optimization.**

ForecastAI is a full-stack enterprise-grade application that transforms raw inventory and sales data into actionable business intelligence using machine learning, probabilistic forecasting, and explainable AI.

---

## Problem Statement

Traditional inventory management relies on manual estimation or simple moving averages. This leads to:
- Stockout events causing lost revenue
- Overstock tying up capital
- Poor supplier lead-time planning
- No visibility into forecast uncertainty

## Proposed Solution

An AI Decision Intelligence platform that provides:
- Multi-model demand forecasting with prediction intervals
- Per-SKU inventory risk scoring with traceable calculations
- What-if scenario simulation engine
- Explainable AI showing exactly why the model made a prediction
- Human-in-the-loop approval workflow for AI recommendations
- Natural language AI Copilot for business queries

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (Port 3000)                │
│  Vanilla JS SPA  ·  Chart.js  ·  Font Awesome 6     │
│  13 pages: Dashboard · Action Center · Scenario Lab  │
│  Copilot · Model Lab · Audit · Data Quality · ...    │
└─────────────────┬───────────────────────────────────┘
                  │ HTTP REST (fetch API)
┌─────────────────▼───────────────────────────────────┐
│                BACKEND (Port 4000)                   │
│  Node.js 18+  ·  Express 4  ·  JWT Auth              │
│  Routes: /api/auth  /api/intelligence  /api/forecast │
│  Rate limiting  ·  CORS  ·  Input validation         │
└─────────────────┬───────────────────────────────────┘
         ┌────────┴────────┐
         │                 │
┌────────▼───────┐  ┌──────▼──────────┐
│  JSON DB       │  │  Python ML       │
│  data.json     │  │  rf_model.py     │
│  audit.json    │  │  scikit-learn    │
│  users · OTPs  │  │  pandas · numpy  │
└────────────────┘  └─────────────────┘
```

---

## ML Pipeline

```
data.csv (48 rows, 4 products × 12 months)
    ↓
Chronological Train/Test Split (75% / 25%)
    ↓
Feature Engineering: sales, inventory, price, month, lead_time
    ↓
Model Training (4 models in parallel):
  · Random Forest    (n_estimators=200)
  · Linear Regression
  · Ridge Regression (α=1.0, StandardScaler)
  · Decision Tree    (max_depth=5)
    ↓
Evaluation on HELD-OUT TEST SET (no data leakage):
  · MAE · RMSE · MAPE · R² · Forecast Bias
    ↓
Best Model Selection (by MAPE)
    ↓
Prediction + Prediction Interval (RF tree variance + residual std)
    ↓
Feature Attribution (SHAP-style baseline perturbation)
    ↓
Risk Engine: stockout/overstock probability, safety stock, coverage days
    ↓
Decision Engine: REORDER_NOW / REORDER_SOON / HOLD / REDUCE_ORDER
```

**Model Results (on test set):**

| Model             | MAE   | RMSE  | MAPE  | R²     |
|-------------------|-------|-------|-------|--------|
| Ridge Regression  | 13.4  | 17.7  | 1.7%  | 0.9926 |
| Linear Regression | 13.9  | 16.6  | 2.0%  | 0.9935 |
| Decision Tree     | 37.1  | 47.8  | 4.5%  | 0.9458 |
| Random Forest     | 48.9  | 66.3  | 5.7%  | 0.8955 |

---

## Five Core Features

### 1. AI Decision & Recommendation Engine
For each SKU, calculates: forecast demand, stockout probability (via normal distribution CDF), safety stock, reorder point, inventory coverage days, recommended order quantity, revenue at risk, and generates one of: `REORDER_NOW`, `REORDER_SOON`, `HOLD`, `REDUCE_ORDER`, `MONITOR`.

All calculations are traceable — no black-box numbers.

### 2. What-If Scenario Simulation Lab
Users apply percentage or absolute changes to demand, price, inventory, or lead time. The Python ML model re-predicts under each scenario. Results show demand delta, stockout risk change, and recommended stock per scenario side-by-side.

### 3. Explainable + Probabilistic Forecasting
Every prediction includes:
- 90% prediction interval (lower, upper bounds) from RF tree variance + training residuals
- Feature contribution breakdown (SHAP-style baseline perturbation)
- Model MAPE and MAE from chronological test split

### 4. AI Inventory Copilot
Natural language interface handling 12 intent categories: stockout queries, reorder recommendations, revenue risk, overstock analysis, product-specific questions, scenario hints, and more. All answers derive from live API data — no hardcoded responses.

### 5. Human-in-the-Loop Action System
AI recommendations require human approval before action. Users can Approve, Reject, or Snooze each recommendation. Every decision is recorded in `audit.json` with timestamp, user, action, model used, and reason.

---

## Features

- **Command Center Dashboard** — 6 live KPI cards, action items, demand chart, product health table
- **Demand Intelligence** — per-product forecast with uncertainty bands and feature explanations
- **Inventory Intelligence** — stockout/overstock analysis with risk badges
- **Scenario Lab** — multi-scenario comparison with live ML re-prediction
- **ForecastAI Copilot** — chat interface with product cards and navigation links
- **Action Center** — review and approve/reject/snooze AI recommendations
- **Model Lab** — compare 4 ML models with test-set metrics and feature importance
- **Data Quality** — upload CSV for automated quality scoring (0-100)
- **Audit Log** — full decision trail with filter and pagination
- **Reports** — export history
- **Help System** — context-aware ? button on every major page
- **Dark Mode** — full dark theme support
- **Authentication** — JWT + OTP (email/SMS) with bcrypt passwords

---

## Installation

### Prerequisites
- Node.js ≥ 18
- Python ≥ 3.9 (accessible as `py` on Windows or `python3` on Linux/Mac)
- pip packages: `pandas scikit-learn numpy`

### 1. Install Python dependencies
```bash
pip install pandas scikit-learn numpy
```

### 2. Install Node.js dependencies
```bash
cd backend
npm install
```

### 3. Configure environment
```bash
cd backend
cp .env.example .env
# Edit .env — set JWT_SECRET (required), SMTP/Twilio (optional for OTP delivery)
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Backend port (default: 4000) |
| `JWT_SECRET` | **Yes** | Min 32-char random string for JWT signing |
| `JWT_EXPIRES_IN` | No | Token lifetime (default: 7d) |
| `SMTP_HOST` | No | Gmail SMTP host (dev: OTP printed to console) |
| `SMTP_PORT` | No | SMTP port (587) |
| `SMTP_USER` | No | Gmail address |
| `SMTP_PASS` | No | Gmail app password |
| `TWILIO_ACCOUNT_SID` | No | Twilio SID (dev: OTP printed to console) |
| `TWILIO_AUTH_TOKEN` | No | Twilio token |
| `TWILIO_PHONE_NUMBER` | No | Twilio phone number |

**Dev mode:** If SMTP/Twilio credentials are not set or contain placeholder values, OTPs are printed to the Node.js console — no external service needed.

---

## Running the System

### Start Backend
```bash
cd backend
npm start
# or for development with auto-reload:
npm run dev
```
Backend runs at `http://localhost:4000`

### Start Frontend
```bash
cd frontend
py -m http.server 3000
# or on Linux/Mac:
python3 -m http.server 3000
```
Frontend at `http://localhost:3000/auth/login.html`

---

## Dataset Format

The default dataset (`backend/data.csv`) has 48 rows across 4 products and 12 months.

**Required columns for upload:**
```
sales, inventory, price, month, demand
```

**Optional columns (used if present):**
```
lead_time, product, category
```

**Minimum rows required:** 4 (for chronological split)

**Sample:**
```csv
sales,inventory,price,month,demand,lead_time
580,1000,85000,9,675,14
620,900,80000,10,720,14
```

---

## API Overview

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register + send OTP |
| POST | `/api/auth/login` | Password login → JWT |
| POST | `/api/auth/verify-otp` | Verify OTP → JWT |
| GET | `/api/auth/me` | Validate session |

### Intelligence
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/intelligence/dashboard` | KPIs + action items |
| GET | `/api/intelligence/products` | All products with risk |
| GET | `/api/intelligence/product/:id` | Single SKU deep analysis |
| POST | `/api/intelligence/scenario` | Scenario simulation |
| GET | `/api/intelligence/models` | Model comparison |
| POST | `/api/intelligence/explain` | SHAP explanation |
| POST | `/api/intelligence/quality` | Data quality analysis |
| GET | `/api/intelligence/audit` | Audit log |
| POST | `/api/intelligence/action` | Approve/reject/snooze |
| POST | `/api/intelligence/copilot` | AI assistant query |

### Forecast
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forecast` | Single point forecast |
| POST | `/api/upload-forecast` | Forecast from uploaded CSV |
| POST | `/api/data-quality` | Quality check CSV rows |
| GET | `/api/models` | Model comparison |

---

## Testing

### Backend API tests (23 tests)
```bash
cd backend
node server.js &   # start server first
node test_api.js
```

### Python ML tests (5 modes)
```bash
cd backend
py test_model.py
```

---

## Limitations

- **Database:** JSON file store (`data.json`) — not suitable for concurrent production use. Replace with SQLite or PostgreSQL for real deployment.
- **Python invocation:** Uses `py` launcher (Windows). Change to `python3` for Linux/Mac in `server.js` and `routes/intelligence.js`.
- **Model retraining:** RF model retrains on every prediction call — no persistence. For production, save the trained model with `joblib` and load it.
- **OTP delivery:** Requires SMTP/Twilio credentials for real delivery. Console fallback is for development only.
- **Dataset size:** 48 rows is sufficient for demonstration but a real deployment needs historical data per SKU (100+ rows recommended).
- **No HTTPS:** Development setup only. Use a reverse proxy (nginx) with TLS in production.

---

## Future Enhancements

- [ ] Replace JSON file store with SQLite/PostgreSQL
- [ ] Add Prophet / ARIMA time-series models for longer horizons
- [ ] Persist trained models to disk with joblib (avoid per-request retraining)
- [ ] Add real-time data ingestion (webhook / ERP integration)
- [ ] Multi-tenant / multi-user support with role-based access
- [ ] Automated retraining triggers when forecast drift is detected
- [ ] Export reports as PDF using Puppeteer or ReportLab
- [ ] Add LSTM model for seasonal demand patterns
- [ ] Supplier lead-time API integration

---

## Demo Flow

1. **Login** → `http://localhost:3000/auth/login.html`
2. **Dashboard** → See live KPIs and action items from ML predictions
3. **Action Center** → Review AI recommendations for Smart Watch S3 and Wireless Headphones
4. **Scenario Lab** → Select Smart Watch S3 → Apply "Demand +25%" → Compare results
5. **Copilot** → Ask "Which products are at risk of stockout?"
6. **Model Lab** → Run comparison → See Ridge Regression as best model (MAPE 1.7%)
7. **Data Quality** → Run quality check on default dataset
8. **Approve action** → Return to Action Center → Approve the REORDER recommendation
9. **Audit Log** → See the decision recorded with timestamp

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML5, CSS3, Chart.js 4.4 |
| Backend | Node.js 18, Express 4 |
| ML | Python 3.9+, scikit-learn, pandas, numpy |
| Auth | JWT, bcrypt, OTP via Nodemailer/Twilio |
| Database | JSON file store (development) |
| Fonts/Icons | Inter (Google Fonts), Font Awesome 6.5 |

---

*This system is intended as an AI-assisted decision support tool. All recommendations require human review before action. Model accuracy is reported from held-out test data and does not guarantee future performance.*
