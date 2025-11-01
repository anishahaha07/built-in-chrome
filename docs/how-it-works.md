# How It Works

This document explains the technical workflow of the MyFi extension.

## 1. User Authentication

- When the user clicks the "Scan Receipts" button, the extension requests permission to access their Gmail account using OAuth 2.0.
- The user is prompted to sign in to their Google account and grant the necessary permissions.

## 2. Receipt Scanning

- Once authenticated, the `background.js` script uses the Gmail API to search for emails with subjects that typically indicate a receipt (e.g., "receipt," "order," "invoice").
- It also searches for emails from popular vendors like Amazon, Swiggy, Zomato, etc.

## 3. AI-Powered Data Extraction

- For each email found, the extension fetches the full email content.
- It then uses the Gemini AI to analyze the email's body and extract the following information:
    - Merchant name
    - Transaction date
    - Total amount paid
    - Category (e.g., food, shopping, travel)
- The extension uses a combination of text and vision models to handle different types of receipts, including those with images.

## 4. Data Storage

- The extracted transaction data is stored locally in the user's browser using the `chrome.storage.local` API.
- This ensures that the user's data is private and secure.

## 5. Visual Insights

- The `popup.js` script retrieves the stored transaction data and displays it in the extension's popup.
- It uses the `chart.min.js` library to create interactive charts and graphs that visualize the user's spending breakdown by category.
- The popup also provides personalized savings tips based on the user's spending habits.
