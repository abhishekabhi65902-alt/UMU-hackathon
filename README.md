# HumusIQ

The source is split into two folders:

- `frontend/` contains the HTML, CSS, browser JavaScript, and farmer image.
- `backend/` contains the Express API and the local JSON data store.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in `backend/` and run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` for the farmer interface or `http://localhost:3000/admin` for admin sign-in. Express serves the sibling `frontend/` folder.

Demo admin credentials: `admin@humusiq.farm` / `farmadmin123`. Set `HUMUSIQ_ADMIN_EMAIL`, `HUMUSIQ_ADMIN_PASSWORD`, and optionally `PORT` before starting to change the demo settings.

The API stores farmer profile summaries, farm assessments, demo predictions, and admin settings in `backend/data/store.json`. Farmer sign-in remains a local browser prototype feature; passwords are not sent to or stored by this API.

## API

`GET /api/health` and `GET /api/settings` are public. Admin sign-in is `POST /api/admin/login`; the returned bearer token protects the `/api/admin/*` routes. Farmer assessment summaries sync to `POST /api/sync`, and prototype crop outputs sync to `POST /api/predictions`.

The JSON file store is for local prototyping. Use a database, HTTPS, and production authentication before hosting real farmer records.
