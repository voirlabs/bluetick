# WhatsApp Cloud API setup

This guide connects the app to WhatsApp through Meta's official Cloud API. A Meta test number is enough to try everything; you don't need business verification until you go to production. The steps follow Meta's dashboard as of November 2026 ([Meta's own guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)); Meta renames things from time to time, so if a label doesn't match exactly, look for the closest option.

The dashboard's **WhatsApp** page checks each step as you go: credentials, the connection to your number (and a warning when the access token is about to expire), a public HTTPS address, whether the app secret belongs to the token's app, whether your WhatsApp account sends the app its messages (with a one-click **Subscribe** if not), whether Meta has delivered a message (and whether a wrong verify token or app secret is getting in the way), and whether the agent is on. Each step that isn't done says what to fix.

## 1. Create a Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create App**. Give it a name and a contact email.
2. For the use case, choose **Connect with customers through WhatsApp**, then pick your business portfolio (or create one) and click **Create app**.
3. You land on **Customize use case → Connect on WhatsApp → Quickstart**. Click **Start using the API** to open **API Setup**.
4. In **API Setup**, connect a **Messaging account** (your WhatsApp Business Account): pick one, or click **Create a WhatsApp Business account**. Meta adds a test phone number to it.

From API Setup, copy:

| Value on the page                        | Environment variable                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Phone number ID (of the **From** number) | `WHATSAPP_PHONE_NUMBER_ID`                                        |
| Token from **Generate access token**     | `WHATSAPP_ACCESS_TOKEN` (expires quickly, see step 5)             |
| Messaging account ID (optional)          | `WHATSAPP_BUSINESS_ACCOUNT_ID` (templates from the inbox, step 3) |

Under **To**, add the phone number you'll test with; Meta asks you to confirm it.

Then from **App settings → Basic**, copy the **App secret** into `WHATSAPP_APP_SECRET`. The app uses it to check that webhooks really come from Meta.

Pick any random string for `WHATSAPP_VERIFY_TOKEN`:

```bash
openssl rand -hex 16
```

## 2. Give Meta a public URL

Meta delivers messages to `https://<your-app>/api/webhooks/whatsapp`, so the app needs a public HTTPS URL.

- **Deployed** (e.g. Vercel): use your deployment URL.
- **Local**: run a tunnel and use its URL.

  ```bash
  pnpm dev                     # app on :3000
  ngrok http 3000              # or: cloudflared tunnel --url http://localhost:3000
  ```

Set `NEXT_PUBLIC_APP_URL` to that URL and restart the app.

## 3. Register the webhook

1. In the Meta app, open **Customize use case → Configuration** (the Webhooks section).
2. **Callback URL**: `https://<your-app>/api/webhooks/whatsapp` (the dashboard's WhatsApp page shows it with a copy button).
3. **Verify token**: your `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta calls the URL once; the app answers if the token matches.
5. In the webhook fields, subscribe to **messages**. Its **Test** button sends a sample to check the connection.
6. Your WhatsApp account must also send this app its messages. The dashboard's **WhatsApp** page checks this and shows a **Subscribe** button if it doesn't. If your token reaches more than one WhatsApp account, set `WHATSAPP_BUSINESS_ACCOUNT_ID` so it knows which one.

While the app is unpublished, Meta only sends those dashboard tests. Real messages, even from your own test number, arrive only after you publish the app (step 5).

## 4. Test it

Publish the app first (see **Publish the app** in step 5); until then Meta doesn't deliver real messages.

1. In the dashboard, finish setup (or switch a paused agent back on under **Agent**).
2. Open **WhatsApp**. The status card should show your test number. If it shows an error, the token or phone number ID is wrong.
3. Under **Send a test message**, enter the number you added under **To** in API Setup. You'll receive Meta's `hello_world` template.
4. Reply to it on your phone. The agent answers within a few seconds, and the conversation appears in **Inbox**.

## 5. Going to production

- **Permanent token.** Tokens from API Setup expire quickly. In [Business Settings](https://business.facebook.com/latest/settings) → **System users**, click **Add** to create a system user. Select it, click **Assign assets** and give it **Manage app** (full control) on your app and **Manage WhatsApp Business accounts** (full control) on your WhatsApp account. Then click **Generate token** with the `business_management`, `whatsapp_business_messaging` and `whatsapp_business_management` permissions, and use it as `WHATSAPP_ACCESS_TOKEN`.
- **Real phone number.** Add and register your business number in [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager/phone-numbers/) and use its phone number ID. A number can't be on the regular WhatsApp app at the same time unless Meta offers you the option to keep both.
- **Business verification and display name.** Needed for higher messaging limits and for your business name to show.
- **Publish the app.** In the app's left menu, choose **Publish**. Meta asks for an app icon, a privacy policy URL and a data deletion URL (and, in the EU, a data protection contact). Use `https://<your-app>/privacy` and `https://<your-app>/data-deletion`, which the app serves; set `PRIVACY_CONTACT_EMAIL` so they show where to write. Meta delivers no real messages to an unpublished app, so this is needed even for testing.

## How messaging works

- Customers message first. Your agent replies inside WhatsApp's 24-hour customer service window.
- Meta bills per message (since July 2025). Since October 1, 2026, each business number gets 1,000 free service replies a month; after that, and for every template message, the rate depends on the customer's country. The dashboard's Overview shows how many free replies are left this month. See [Meta's pricing](https://developers.facebook.com/docs/whatsapp/pricing) for current rates.
- After 24 hours without a customer message, WhatsApp only allows approved template messages. The inbox shows this and blocks free-form replies.
- A customer who sends exactly `STOP` (or `unsubscribe`, `opt out`) gets no further replies, from the agent or from the inbox, until they send `START`. Their messages are still stored.
- Meta's terms don't allow general-purpose AI assistants on the Business API. Business agents (support, bookings, orders, sales) are fine.

## Troubleshooting

| Symptom                                                 | Check                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Verify and save" fails                                 | `WHATSAPP_VERIFY_TOKEN` matches exactly; the URL is public and HTTPS; the app was restarted after setting env vars                                                                                                                                                                         |
| Webhook verified but no replies                         | The app is published (unpublished apps get only dashboard test webhooks); subscribed to the **messages** field; the agent is **active** (a paused agent leaves messages in the inbox); `WHATSAPP_APP_SECRET` is correct (wrong secret = `rejected webhook with invalid signature` in logs) |
| Status card shows an error                              | Token expired (tokens from API Setup are short-lived; use a system user token) or wrong `WHATSAPP_PHONE_NUMBER_ID`                                                                                                                                                                         |
| Test message fails with "recipient not in allowed list" | Add and confirm the number under **To** in API Setup                                                                                                                                                                                                                                       |
| Replies stop after a while                              | Check the conversation isn't handed off (the inbox shows **A person is replying**) and the customer hasn't sent STOP                                                                                                                                                                       |
