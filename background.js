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
    const query = `subject:(receipt OR order OR invoice OR confirmation) OR from:(amazon.com OR swiggy.in OR zomato.com OR uber.com OR flipkart.com OR ola.com OR blinkit.com OR myntra.com OR ajio.com OR spotify.com OR paypal OR stripe OR apple.com) after:${afterDate}`;
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
      const geminiApiKey = "AIzaSyAqMWwrIIM_NQpZ6UjTsbqWu2xKz8DHxes";
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
        await new Promise((resolve) => setTimeout(resolve, 100));
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
    const htmlContent = extractHTMLContent(email);
    const subject = getEmailSubject(email);
    const from = getEmailFrom(email);
    const date = getEmailDate(email);
    const images = extractImagesFromEmail(email);

    console.log("\n=== Processing Email ===");
    console.log("Subject:", subject);
    console.log("From:", from);
    console.log("Date:", date);
    console.log("Body preview:", body.substring(0, 300));
    console.log("HTML length:", htmlContent.length);
    console.log("Images found:", images.length);

    // Skip promotional emails
    if (isPromotionalEmail(subject, htmlContent)) {
      console.log("⊘ Skipping promotional email");
      continue;
    }

    // extract from HTML structure first
    const htmlExtracted = extractFromHTML(htmlContent, subject, from, date);
    if (htmlExtracted) {
      console.log("✓ Extracted from HTML structure:", htmlExtracted);
    }

    if (!body && !htmlContent && images.length === 0) {
      console.warn("Skipping email - no content found");
      continue;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      let data;

      // Priority 1: Use HTML extraction if successful
      if (htmlExtracted && htmlExtracted.amount > 0) {
        console.log("Using HTML extracted data");
        data = htmlExtracted;
      }
      // Priority 2: If images found, use vision model
      else if (images.length > 0) {
        console.log("Using vision model for image analysis...");
        data = await analyzeReceiptImage(
          images[0],
          subject,
          from,
          date,
          apiKey
        );
      }
      // Priority 3: Use text-only model with HTML content
      else if (htmlContent) {
        console.log("Using AI for HTML content analysis...");
        const receiptContent = extractReceiptContent(htmlContent, body);
        data = await analyzeReceiptText(
          receiptContent,
          subject,
          from,
          date,
          apiKey
        );
      }
      // Priority 4: Use plain text body
      else {
        console.log("Using AI for text body analysis...");
        const receiptContent = extractReceiptContent(null, body);
        data = await analyzeReceiptText(
          receiptContent,
          subject,
          from,
          date,
          apiKey
        );
      }

      if (!data) {
        console.warn("No data extracted, skipping");
        continue;
      }

      console.log("Parsed data:", data);

      // Skip if default response
      if (data.amount === 0 && data.merchant === "Unknown") {
        console.warn("⊘ Skipping - looks like default/empty data");
        continue;
      }

      // Skip if amount is 0
      if (data.amount === 0) {
        console.warn("⊘ Skipping - zero amount (likely promotional)");
        continue;
      }

      extractedData.push({
        merchant: String(data.merchant || "Unknown").trim(),
        date: validateDate(data.date, date),
        amount: parseFloat(data.amount) || 0,
        category: validateCategory(data.category),
        currency: data.currency || "INR",
        from: from,
        subject: subject,
        hasImage: images.length > 0,
      });

      const currencySymbol = data.currency === "USD" ? "$" : "₹";
      console.log(
        `✓ Extracted: ${data.merchant} - ${data.date} - ${currencySymbol}${data.amount}`
      );
      console.log("========================\n");
    } catch (error) {
      console.error("Error parsing email with Gemini:", error.message);
      extractedData.push({
        merchant: extractMerchantFromEmail(from, subject),
        date: date,
        amount: 0,
        category: "other",
        currency: "INR",
        from: from,
        subject: subject,
        error: true,
      });
    }
  }

  return extractedData;
}

async function analyzeReceiptImage(imageData, subject, from, date, apiKey) {
  const prompt = `Extract receipt data from this image. Return ONLY JSON.

Context: ${subject} | ${from} | ${date}

Extract:
- merchant: Company name
- date: Transaction date (YYYY-MM-DD)
- amount: Total amount (number with decimals)
- category: "food", "groceries", "shopping", "travel", "entertainment", "other"
- currency: "INR" or "USD"

Return ONLY JSON: {"merchant": "...", "date": "...", "amount": 75.75, "category": "...", "currency": "INR"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: imageData.mimeType,
                  data: imageData.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 150,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Gemini Vision API error ${response.status}:`, errorText);
    return null;
  }

  const result = await response.json();

  if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
    console.warn("Invalid Gemini response structure");
    return null;
  }

  let aiResponse = result.candidates[0].content.parts[0].text.trim();
  aiResponse = aiResponse
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  console.log("Vision AI Response:", aiResponse);

  return JSON.parse(aiResponse);
}

async function analyzeReceiptText(body, subject, from, date, apiKey) {
  const prompt = `Extract receipt data from this content. Return ONLY JSON.

Subject: ${subject}
From: ${from}
Date: ${date}
Content: ${body}

Extract:
- merchant: Company name
- date: Transaction date (YYYY-MM-DD)
- amount: Total amount (number with decimals)
- category: "food", "groceries", "shopping", "travel", "entertainment", "other"
- currency: "INR" or "USD"

Rules:
- Use transaction date, not email date
- Extract FULL amount with decimals
- Return ONLY JSON: {"merchant": "...", "date": "...", "amount": 75.75, "category": "...", "currency": "INR"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 100,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Gemini API error ${response.status}:`, errorText);
    return null;
  }

  const result = await response.json();

  if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
    console.warn("Invalid Gemini response structure");
    return null;
  }

  let aiResponse = result.candidates[0].content.parts[0].text.trim();
  aiResponse = aiResponse
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  console.log("Text AI Response:", aiResponse);

  return JSON.parse(aiResponse);
}

function extractHTMLContent(email) {
  const parts = email.payload.parts || [email.payload];

  function findHTML(parts) {
    for (let part of parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
      if (part.parts) {
        const found = findHTML(part.parts);
        if (found) return found;
      }
    }
    return null;
  }
  return findHTML(parts) || "";
}
function isPromotionalEmail(subject, html) {
  const promoKeywords = [
    /want \d+% off/i,
    /save up to/i,
    /get \d+% off/i,
    /discount/i,
    /promo/i,
    /offer/i,
    /don't miss/i,
    /limited time/i,
    /special deal/i,
    /exclusive/i,
  ];
  const subjectLower = subject.toLowerCase();
  for (let keyword of promoKeywords) {
    if (keyword.test(subjectLower)) {
      return true;
    }
  }
  if (/receipt|invoice|order|trip with|your.*trip/i.test(subject)) {
    return false;
  }
  return false;
}
function extractFromHTML(html, subject, from, emailDate) {
  if (!html) return null;
  try {
    // Extract merchant
    let merchant = "Unknown";
    const merchantPatterns = [
      /uber/i,
      /swiggy/i,
      /zomato/i,
      /amazon/i,
      /flipkart/i,
      /ola/i,
      /blinkit/i,
      /myntra/i,
      /ajio/i,
    ];
    for (let pattern of merchantPatterns) {
      if (pattern.test(from) || pattern.test(subject)) {
        merchant = pattern.source.replace(/[\/\\^$*+?.()|[\]{}]/g, "");
        merchant = merchant.charAt(0).toUpperCase() + merchant.slice(1);
        break;
      }
    }
    const amountPatterns = [
      /(?:total|grand total|amount paid|bill amount|fare|trip total|order total)[:\s]*(?:₹|rs\.?|inr)?\s*([0-9,]+\.?[0-9]{0,2})/gi,
      /₹\s*([0-9,]+\.[0-9]{2})/g,
      /rs\.?\s*([0-9,]+\.[0-9]{2})/gi,
      /₹\s*([0-9,]+\.?[0-9]*)/g,
      /rs\.?\s*([0-9,]+\.?[0-9]*)/gi,
      /inr\s*([0-9,]+\.?[0-9]*)/gi,
      /\$\s*([0-9,]+\.[0-9]{2})/g,
      /usd\s*([0-9,]+\.?[0-9]*)/gi,
    ];
    let amounts = [];
    let currency = "INR";
    if (html.includes("₹") || /rs\.?/i.test(html) || /inr/i.test(html)) {
      currency = "INR";
    } else if (html.includes("$") || /usd/i.test(html)) {
      currency = "USD";
    }
    for (let pattern of amountPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);
        if (amount > 0 && amount < 1000000) {
          const hasDecimals =
            amountStr.includes(".") && amountStr.split(".")[1].length === 2;
          amounts.push({
            value: amount,
            priority: hasDecimals ? 2 : 1,
            source: match[0],
          });
        }
      }
    }
    console.log(
      "Found amounts in HTML:",
      amounts.map((a) => `${a.value} (${a.source.substring(0, 50)})`)
    );
    let transactionDate = emailDate;
    const contextualDatePatterns = [
      /(?:trip|order|purchased|delivered|paid)\s+(?:on|at)?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
      /(?:trip|order|purchased|delivered|paid)\s+(?:on|at)?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)/gi,
      /trip date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
      /order date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
    ];
    for (let pattern of contextualDatePatterns) {
      const match = pattern.exec(html);
      if (match && match[1]) {
        try {
          const parsed = new Date(match[1]);
          if (
            !isNaN(parsed.getTime()) &&
            parsed <= new Date() &&
            parsed.getFullYear() >= 2024
          ) {
            transactionDate = parsed.toISOString().split("T")[0];
            console.log(
              "Found contextual date:",
              transactionDate,
              "from:",
              match[0]
            );
            break;
          }
        } catch (e) {}
      }
    }
    if (transactionDate === emailDate) {
      const genericDatePatterns = [
        /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/g,
        /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/g,
        /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})/gi,
      ];
      let foundDates = [];
      for (let pattern of genericDatePatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          try {
            const parsed = new Date(match[1]);
            if (
              !isNaN(parsed.getTime()) &&
              parsed <= new Date() &&
              parsed.getFullYear() >= 2024
            ) {
              foundDates.push(parsed);
            }
          } catch (e) {}
        }
      }

      if (foundDates.length > 0) {
        foundDates.sort((a, b) => b - a);
        transactionDate = foundDates[0].toISOString().split("T")[0];
      }
    }
    let category = "other";
    if (/uber|ola|taxi|cab|ride/i.test(html) || /uber|ola/i.test(from)) {
      category = "travel";
    } else if (
      /swiggy|zomato|food|restaurant|delivery/i.test(html) ||
      /swiggy|zomato/i.test(from)
    ) {
      category = "food";
    } else if (
      /amazon|flipkart|shopping|order|product/i.test(html) ||
      /amazon|flipkart/i.test(from)
    ) {
      category = "shopping";
    } else if (/blinkit|grocery/i.test(html)) {
      category = "groceries";
    }
    if (amounts.length > 0) {
      amounts.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.value - a.value;
      });
      const bestAmount = amounts[0];
      console.log(
        "Selected amount:",
        bestAmount.value,
        "from:",
        bestAmount.source.substring(0, 50)
      );
      return {
        merchant,
        date: transactionDate,
        amount: bestAmount.value,
        category,
        currency,
      };
    }
    return null;
  } catch (error) {
    console.error("Error extracting from HTML:", error);
    return null;
  }
}
function extractImagesFromEmail(email) {
  const images = [];
  const parts = email.payload.parts || [email.payload];
  function processParts(parts) {
    for (let part of parts) {
      if (part.mimeType && part.mimeType.startsWith("image/")) {
        if (part.body?.attachmentId) {
          console.log("Found image attachment:", part.filename);
        } else if (part.body?.data) {
          images.push({
            mimeType: part.mimeType,
            data: part.body.data.replace(/-/g, "+").replace(/_/g, "/"),
            filename: part.filename || "inline",
          });
          console.log("Found inline image:", part.filename || "inline");
        }
      }
      if (part.parts) {
        processParts(part.parts);
      }
    }
  }
  processParts(parts);
  return images;
}
function decodeEmailBody(email) {
  const parts = email.payload.parts || [email.payload];
  for (let part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      const decoded = atob(
        part.body.data.replace(/-/g, "+").replace(/_/g, "/")
      );
      if (decoded.length > 50) return decoded;
    }
    if (part.parts) {
      const nestedBody = decodeEmailBodyFromParts(part.parts);
      if (nestedBody && nestedBody.length > 50) return nestedBody;
    }
  }
  for (let part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      const html = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      const text = html
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 50) return text;
    }
    if (part.parts) {
      for (let nested of part.parts) {
        if (nested.mimeType === "text/html" && nested.body?.data) {
          const html = atob(
            nested.body.data.replace(/-/g, "+").replace(/_/g, "/")
          );
          const text = html
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim();
          if (text.length > 50) return text;
        }
      }
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
function getEmailDate(email) {
  const headers = email.payload.headers;
  const dateHeader = headers.find((h) => h.name.toLowerCase() === "date");
  if (dateHeader) {
    try {
      const emailDate = new Date(dateHeader.value);
      if (!isNaN(emailDate.getTime())) {
        return emailDate.toISOString().split("T")[0];
      }
    } catch (e) {
      console.warn("Could not parse email date:", dateHeader.value);
    }
  }
  return new Date().toISOString().split("T")[0];
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
function validateDate(dateStr, fallbackDate) {
  if (!dateStr) return fallbackDate || new Date().toISOString().split("T")[0];
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return fallbackDate || new Date().toISOString().split("T")[0];
  }

  if (date > new Date()) {
    return fallbackDate || new Date().toISOString().split("T")[0];
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

function extractReceiptContent(htmlContent, plainText) {
  // Priority 1: Extract from HTML if available
  if (htmlContent) {
    const htmlReceipt = extractReceiptFromHTML(htmlContent);
    if (htmlReceipt) {
      console.log("Extracted receipt content from HTML:", htmlReceipt.length, "chars");
      return htmlReceipt;
    }
  }
  
  // Priority 2: Extract from plain text
  if (plainText) {
    const textReceipt = extractReceiptFromText(plainText);
    if (textReceipt) {
      console.log("Extracted receipt content from text:", textReceipt.length, "chars");
      return textReceipt;
    }
  }
  
  // Fallback: return truncated content
  const content = htmlContent || plainText || "";
  return content.substring(0, 2000); // Much smaller fallback
}

function extractReceiptFromHTML(html) {
  try {
    // Remove script tags, style tags, and other non-content elements
    let cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
      .replace(/<embed[^>]*>[\s\S]*?<\/embed>/gi, '');
    
    // Look for receipt-specific sections
    const receiptPatterns = [
      /<div[^>]*class="[^"]*(?:receipt|invoice|order|bill|payment|total|amount)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      /<table[^>]*class="[^"]*(?:receipt|invoice|order|bill|payment|total|amount)[^"]*"[^>]*>[\s\S]*?<\/table>/gi,
      /<section[^>]*class="[^"]*(?:receipt|invoice|order|bill|payment|total|amount)[^"]*"[^>]*>[\s\S]*?<\/section>/gi,
      /<div[^>]*id="[^"]*(?:receipt|invoice|order|bill|payment|total|amount)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ];
    
    for (let pattern of receiptPatterns) {
      const matches = cleanHtml.match(pattern);
      if (matches && matches.length > 0) {
        const receiptSection = matches.join('\n');
        // Extract text content from the receipt section
        const textContent = receiptSection
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (textContent.length > 50) {
          return textContent;
        }
      }
    }
    
    // If no specific receipt sections found, look for tables with financial data
    const tablePattern = /<table[^>]*>[\s\S]*?(?:total|amount|price|₹|rs\.?|\$)[\s\S]*?<\/table>/gi;
    const tableMatches = cleanHtml.match(tablePattern);
    if (tableMatches && tableMatches.length > 0) {
      const tableContent = tableMatches.join('\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (tableContent.length > 30) {
        return tableContent;
      }
    }
    
    // Fallback: extract content around financial keywords
    const financialKeywords = /(?:total|amount|price|₹|rs\.?|\$|order|receipt|invoice|bill|payment)/gi;
    const lines = cleanHtml.split('\n');
    const relevantLines = [];
    
    for (let line of lines) {
      if (financialKeywords.test(line) || 
          /₹\s*\d+|\$\s*\d+|rs\.?\s*\d+|\d+\.\d{2}/.test(line)) {
        const cleanLine = line
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanLine.length > 10) {
          relevantLines.push(cleanLine);
        }
      }
    }
    
    if (relevantLines.length > 0) {
      return relevantLines.join('\n');
    }
    
  } catch (error) {
    console.error("Error extracting receipt from HTML:", error);
  }
  
  return null;
}

function extractReceiptFromText(text) {
  try {
    const lines = text.split('\n');
    const relevantLines = [];
    
    // Keywords that indicate receipt content
    const receiptKeywords = [
      'total', 'amount', 'price', 'order', 'receipt', 'invoice', 'bill', 'payment',
      'subtotal', 'tax', 'delivery', 'service', 'fare', 'trip', 'booking'
    ];
    
    // Currency patterns
    const currencyPattern = /(?:₹|rs\.?|\$|usd|inr)\s*\d+(?:\.\d{2})?/i;
    
    for (let line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Check if line contains receipt keywords or currency
      const hasReceiptKeyword = receiptKeywords.some(keyword => lowerLine.includes(keyword));
      const hasCurrency = currencyPattern.test(line);
      
      if (hasReceiptKeyword || hasCurrency) {
        const cleanLine = line.trim();
        if (cleanLine.length > 5) {
          relevantLines.push(cleanLine);
        }
      }
    }
    
    if (relevantLines.length > 0) {
      // Limit to most relevant lines (avoid sending too much)
      const maxLines = Math.min(relevantLines.length, 20);
      return relevantLines.slice(0, maxLines).join('\n');
    }
    
  } catch (error) {
    console.error("Error extracting receipt from text:", error);
  }
  
  return null;
}
