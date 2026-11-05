# Vendor Mail Portal - Static Netlify + Google OAuth Migration

This project is a static web app that replaces the old Google Apps Script web app with Google Identity Services login and direct Gmail API sending.

## What changed

- Removed dependency on Google Apps Script web hosting
- Added Google OAuth 2.0 login using the Google Identity Services SDK
- Uses the signed-in user's OAuth access token to send mail from their Gmail account
- Sends mail through the Gmail REST API with RFC 822 raw payloads
- Runs as a simple static site on Netlify

## Files

- `index.html` – app shell and form UI
- `app.js` – OAuth flow, session handling, and raw Gmail message sending

## Google Cloud Console setup

1. Open Google Cloud Console: https://console.cloud.google.com/
2. Create a new project or choose an existing one.
3. Enable the Gmail API:
   - Go to APIs & Services > Library
   - Search for Gmail API
   - Click Enable
4. Configure the OAuth consent screen:
   - Go to APIs & Services > OAuth consent screen
   - Select External if you want any Google account to sign in
   - Fill in app name, support email, and authorized domain information
   - Add the Gmail send scope:
     - `https://www.googleapis.com/auth/gmail.send`
   - Add profile and email scopes if you want profile data available in the app:
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`
5. Create an OAuth client ID:
   - Go to APIs & Services > Credentials
   - Click Create Credentials > OAuth client ID
   - Application type: Web application
   - Name: Vendor Mail Portal
   - Authorized JavaScript origins:
     - `http://localhost:8000`
     - `https://your-app.netlify.app`
   - Authorized redirect URIs: for the token client flow, you usually do not need redirect URIs for a pure front-end token flow. If you later add `google.accounts.id` or code flow, add the exact app origin here too.
6. Copy the generated Client ID.
7. Replace the placeholder value in `index.html`:
   - `window.GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';`

## Netlify deployment

1. Push the project to a GitHub repository.
2. Log into Netlify and click Add new site > Import an existing project.
3. Select the repository.
4. Use the following publish settings:
   - Publish directory: `.`
   - Build command: leave blank
5. Deploy the site.
6. After deployment, open the production URL and verify the Google sign-in button loads.
7. Add your production domain to the Google OAuth authorized JavaScript origins in Cloud Console:
   - `https://your-app.netlify.app`

## Local development

Run a simple web server in the project folder, for example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes

- The Gmail API will send mail from the signed-in Google account.
- Use the OAuth token only in the browser; do not store it on a server unless you explicitly design for it.
- Gmail raw API requires a base64url-encoded RFC 822 message body.
- The frontend can also attach files if needed by building a multipart MIME message.
