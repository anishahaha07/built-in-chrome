// background.js
console.log("Background script loaded");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated");
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError) {
      console.error("Auth error:", chrome.runtime.lastError.message);
      return;
    }
    console.log("Auth token acquired");
    chrome.storage.local.set({ authToken: token });
    fetchReceiptEmails(token);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received:", message);
  if (message.action === "refreshEmails") {
    chrome.storage.local.get(["authToken"], ({ authToken }) => {
      if (authToken) {
        fetchReceiptEmails(authToken);
      } else {
        chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
          if (chrome.runtime.lastError) {
            console.error("Auth error:", chrome.runtime.lastError.message);
            return;
          }
          chrome.storage.local.set({ authToken: newToken });
          fetchReceiptEmails(newToken);
        });
      }
    });
    sendResponse({ status: "Processing" });
  }
  return true;
});

async function fetchReceiptEmails(token) {
  console.log("Fetching emails...");
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    const afterDate = oneMonthAgo.toISOString().split("T")[0];

    const query = `subject:(receipt OR order OR invoice OR confirmation) OR from:(amazon.com OR swiggy.in OR zomato.com OR uber.com OR flipkart.com OR ola.com OR blinkit.com OR myntra.com OR ajio.com) after:${afterDate}`;

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
        query
      )}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log("Gmail API response status:", response.status);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Found ${data.messages?.length || 0} potential receipt emails`);

    if (data.messages) {
      const emails = await fetchEmailDetails(data.messages, token);
      const geminiApiKey = "AIzaSyAqMWwrIIM_NQpZ6UjTsbqWu2xKz8DHxes"; // Replace with your API key
      const extractedData = await parseEmailsWithGemini(emails, geminiApiKey);

      chrome.storage.local.set(
        { extractedData, lastScanned: Date.now() },
        () => {
          console.log(`Successfully stored ${extractedData.length} receipts`);
        }
      );
    } else {
      console.log("No receipt emails found");
      chrome.storage.local.set({ extractedData: [], lastScanned: Date.now() });
    }
  } catch (error) {
    console.error("Error fetching emails:", error);
    chrome.storage.local.set({
      extractedData: [],
      lastScanned: Date.now(),
      error: error.message,
    });
  }
}

async function fetchEmailDetails(messages, token) {
  const emails = [];

  for (let i = 0; i < messages.length; i++) {
    try {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Reduced delay
      }

      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messages[i].id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.status === 429) {
        console.log("Rate limit hit, waiting 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        i--;
        continue;
      }

      if (!response.ok) {
        console.warn(
          `Failed to fetch email ${messages[i].id}: ${response.status}`
        );
        continue;
      }

      const emailData = await response.json();
      emails.push(emailData);
    } catch (error) {
      console.error(`Error fetching email ${messages[i].id}:`, error);
    }
  }

  return emails;
}

async function parseEmailsWithGemini(emails, apiKey) {
  const extractedData = [];

  for (let email of emails) {
    const body = decodeEmailBody(email);
    const subject = getEmailSubject(email);
    const from = getEmailFrom(email);

    if (!body) {
      console.warn("Skipping email with no body");
      continue;
    }

    const truncatedBody = body.substring(0, 5000);
    //Make the prompt better, too long
    const prompt = `Extract receipt/order details from this email and return ONLY valid JSON with no markdown, code blocks, or extra text.

Email Subject: ${subject}
From: ${from}
Body: ${truncatedBody}

Extract:
- merchant: The company/store name (e.g., "Amazon", "Swiggy", "Zomato")
- date: Purchase date in YYYY-MM-DD format
- amount: Total amount as a number (extract from "Total", "Amount Paid", etc.)
- category: One of: "food", "groceries", "shopping", "travel", "entertainment", "other"

Rules:
- If merchant unclear, use the sender domain or "Unknown"
- If date missing, use "2025-10-16"
- If amount missing or unclear, use 0
- Always return valid JSON with these exact fields
- Extract currency amounts (₹, Rs, $) as numbers only

Example output:
{"merchant": "Amazon", "date": "2025-10-15", "amount": 1299.50, "category": "shopping"}`;

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, //models -> 2.5 flash , gemini-1.5-flash, no exp versions
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              topP: 0.8,
              maxOutputTokens: 200,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API error ${response.status}:`, errorText);
        continue;
      }

      const result = await response.json();

      if (
        !result.candidates ||
        !result.candidates[0]?.content?.parts?.[0]?.text
      ) {
        console.warn("Invalid Gemini response structure");
        continue;
      }

      let aiResponse = result.candidates[0].content.parts[0].text.trim();

      //improve markdown responses
      aiResponse = aiResponse
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log("AI Response:", aiResponse);

      const data = JSON.parse(aiResponse);

      extractedData.push({
        merchant: String(data.merchant || "Unknown").trim(),
        date: validateDate(data.date),
        amount: parseFloat(data.amount) || 0,
        category: validateCategory(data.category),
        from: from,
        subject: subject,
      });

      console.log(`✓ Extracted: ${data.merchant} - ₹${data.amount}`);
    } catch (error) {
      console.error("Error parsing email with Gemini:", error.message);
      //fallback
      extractedData.push({
        merchant: extractMerchantFromEmail(from, subject),
        date: new Date().toISOString().split("T")[0],
        amount: 0,
        category: "other",
        from: from,
        subject: subject,
        error: true,
      });
    }
  }

  return extractedData;
}

function decodeEmailBody(email) {
  const parts = email.payload.parts || [email.payload];

  for (let part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }

    // Check for HTML
    if (part.mimeType === "text/html" && part.body?.data) {
      const html = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (part.parts) {
      const nestedBody = decodeEmailBodyFromParts(part.parts);
      if (nestedBody) return nestedBody;
    }
  }

  return "";
}

function decodeEmailBodyFromParts(parts) {
  for (let part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }
  }
  return null;
}

function getEmailSubject(email) {
  const headers = email.payload.headers;
  const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject");
  return subjectHeader?.value || "";
}

function getEmailFrom(email) {
  const headers = email.payload.headers;
  const fromHeader = headers.find((h) => h.name.toLowerCase() === "from");
  return fromHeader?.value || "";
}

function extractMerchantFromEmail(from, subject) {
  const emailMatch = from.match(/@([^.]+)\./);
  if (emailMatch) {
    return emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);
  }

  const merchants = [
    "amazon",
    "flipkart",
    "swiggy",
    "zomato",
    "uber",
    "ola",
    "myntra",
  ];
  for (let merchant of merchants) {
    if (subject.toLowerCase().includes(merchant)) {
      return merchant.charAt(0).toUpperCase() + merchant.slice(1);
    }
  }

  return "Unknown";
}

function validateDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split("T")[0];

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return new Date().toISOString().split("T")[0];
  }

  return dateStr;
}

function validateCategory(category) {
  const validCategories = [
    "food",
    "groceries",
    "shopping",
    "travel",
    "entertainment",
    "other",
  ];
  const cat = String(category || "")
    .toLowerCase()
    .trim();
  return validCategories.includes(cat) ? cat : "other";
}
