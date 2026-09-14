# RoadBook — Transport Business Tracker

A single-page web app for a transport business owner to track **vehicles, bookings,
drivers, and expenses** — and always know the real profit, overall and per vehicle.

Built exactly to the v1 PRD: no login, no backend, no build step. Data persists in
the browser's `localStorage`, works on phone and desktop.

## Features

- **Dashboard** — total revenue, total expenses, net profit (live), pending
  (unpaid) bookings count + amount, profit-per-vehicle table, recent bookings
  and recent expenses, quick actions.
- **Vehicles** — add/edit/delete fleet vehicles (number plate, model, notes).
  Each card shows its own revenue, expenses and net profit, auto-calculated.
- **Bookings** — date, customer, pickup → drop, vehicle + driver (fleet
  dropdowns), amount, Paid/Pending status (toggle inline), notes. Searchable,
  filterable by status/vehicle, most recent first.
- **Drivers** — name, phone (tap-to-call), assigned vehicle, salary type
  (Fixed monthly / Per trip) + amount. Cards show trips, trip revenue and
  salary paid out.
- **Expenses** — Fuel / Driver salary / Maintenance / Other, linked vehicle +
  driver, amount, notes. Filterable by type/vehicle with a running total.
- **Backup & settings** — download/restore JSON backup, load sample data,
  delete all data.
- Currency in **₹ (INR)**, responsive layout (sidebar on desktop, bottom
  tab-bar + quick-add sheet on mobile).

## Run it

No dependencies. Either:

```bash
# serve locally (recommended — keeps one origin for storage)
python3 -m http.server 8000
# then open http://localhost:8000
```

…or just open `index.html` directly in a browser.

## Project structure

```
index.html      # app shell: sidebar, views, modal/confirm/sheet roots
css/styles.css  # all styling, no frameworks
js/app.js       # store (localStorage), stats, views, forms, backup
```

## Data model

```
Vehicle:  { id, number, model, notes }
Booking:  { id, date, customer, from, to, vehicleId, driverId, amount, status, notes }
Driver:   { id, name, phone, vehicleId, salaryType, salaryAmount }
Expense:  { id, date, type, driverId, vehicleId, amount, notes }
```

Deleting a vehicle/driver keeps the linked bookings/expenses and simply
unassigns them — history is never lost by accident.

## Roadmap (from PRD future scope)

Monthly/yearly reports & charts · per-vehicle trends · fuel-efficiency
tracking · Excel/PDF export · multi-user roles.
