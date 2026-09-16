# Nepkits Hub

Nepkits Hub ecommerce starter with storefront, customer login, admin dashboard, product management, store branding and payment QR settings.

## Local

```bash
npm install
npm start
```

Open http://localhost:3000.

## Netlify

Connect this repository to Netlify. Add these environment variables in Netlify:

- `JWT_SECRET` — long random secret
- `ADMIN_EMAIL` — private admin login email
- `ADMIN_PASSWORD` — private admin login password

Do not commit credentials to GitHub.

## Important production note

The current demo backend uses a JSON file for local persistence. Before processing real customer orders on a serverless deployment, replace that storage with a persistent database/storage service and move uploaded product/payment images to persistent object storage.
