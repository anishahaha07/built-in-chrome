console.log("Background script loaded");
let isScanning = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received:", message);

  if (message.action === "refreshEmails") {
    if (isScanning) {
      sendResponse({ status: "Already scanning…" });
      return true;
    }

    isScanning = true;
    scanWithTokenRefresh().finally(() => (isScanning = false));

    sendResponse({ status: "Processing" });
  }
  return true;
});
async function scanWithTokenRefresh() {
  try {
    // 1. Try to read a cached token
    const { authToken } = await chrome.storage.local.get(["authToken"]);

    // 2. If we have one → use it, otherwise get a fresh one
    const token = authToken ?? (await getFreshToken());
    if (!authToken) await chrome.storage.local.set({ authToken: token });

    await fetchReceiptEmails(token);
  } catch (err) {
    // ------------------------------------------------------------
    // 401 / token-invalid → silently refresh and retry once
    // ------------------------------------------------------------
    if (err.message.includes("401") || err.message.includes("invalid token")) {
      console.warn("Token expired – refreshing…");
      try {
        const newToken = await getFreshToken();
        await chrome.storage.local.set({ authToken: newToken });
        await fetchReceiptEmails(newToken);
      } catch (refreshErr) {
        console.error("Refresh failed:", refreshErr);
        await chrome.storage.local.set({
          error: "Auth failed – please re-authenticate.",
        });
      }
    } else {
      console.error("Scan error:", err);
      await chrome.storage.local.set({ error: err.message });
    }
  }
}

/* --------------------------------------------------------------
   Helper – always request an *interactive* token
   -------------------------------------------------------------- */
function getFreshToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error("No token returned"));
      } else {
        resolve(token);
      }
    });
  });
}
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
      const geminiApiKey = "your-gemini-api-key";
      const extractedData = await parseEmailsWithGemini(
        emails,
        geminiApiKey,
        token
      );
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
    console.error("Error fetching emails:", error.message);
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
      console.error(`Error fetching email ${messages[i].id}:`, error.message);
    }
  }
  return emails;
}

async function parseEmailsWithGemini(emails, apiKey, token) {
  const extractedData = [];
  let apiCallCount = 0;
  const MAX_API_CALLS_PER_MINUTE = 8; // Stay under the 10/min limit

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

    // IMPROVED: Better promotional email detection
    if (isPromotionalEmail(subject, htmlContent, from)) {
      console.log("⊘ Skipping promotional email");
      continue;
    }

    const htmlExtracted = extractFromHTML(htmlContent, subject, from, date);
    if (htmlExtracted) {
      console.log("✓ Extracted from HTML structure:", htmlExtracted);
    }

    if (!body && !htmlContent && images.length === 0) {
      console.warn("Skipping email - no content found");
      continue;
    }

    try {
      // Add delay between processing to avoid rate limits
      if (apiCallCount >= MAX_API_CALLS_PER_MINUTE) {
        console.log("⏳ Rate limit protection: waiting 60 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 60000));
        apiCallCount = 0;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      let data;

      // STRATEGY: Try HTML extraction first, then fallback to AI only if needed
      // This reduces API calls and avoids rate limits

      if (htmlExtracted && htmlExtracted.amount >= 10) {
        console.log("✓ Using HTML extracted data");
        data = htmlExtracted;
      } else if (images.length > 0) {
        console.log("Using vision model for image analysis...");
        const imageData = await getImageData(images[0], email.id, token);
        if (imageData) {
          data = await analyzeReceiptImage(
            imageData,
            subject,
            from,
            date,
            apiKey
          );
          apiCallCount++; // Count AI API calls
        }
      } else {
        // Try more aggressive HTML/text extraction before using AI
        console.log("Attempting aggressive text extraction...");
        const fallbackData = extractFromPlainText(
          body || htmlContent,
          subject,
          from,
          date
        );

        if (fallbackData && fallbackData.amount >= 10) {
          console.log("✓ Using aggressive text extraction");
          data = fallbackData;
        } else if (htmlContent) {
          console.log("Using AI for HTML content analysis...");
          const truncatedHTML = htmlContent.substring(0, 8000);
          data = await analyzeReceiptText(
            truncatedHTML,
            subject,
            from,
            date,
            apiKey
          );
          apiCallCount++; // Count AI API calls
        } else if (body) {
          console.log("Using AI for text body analysis...");
          const truncatedBody = body.substring(0, 5000);
          data = await analyzeReceiptText(
            truncatedBody,
            subject,
            from,
            date,
            apiKey
          );
          apiCallCount++; // Count AI API calls
        }
      }

      if (!data) {
        console.warn("No data extracted, skipping");
        continue;
      }

      console.log("Parsed data:", data);

      if (data.amount === 0 && data.merchant === "Unknown") {
        console.warn("⊘ Skipping - looks like default/empty data");
        continue;
      }

      // FIXED: Skip very small amounts (likely page numbers or noise)
      if (data.amount < 10 && data.amount > 0) {
        console.warn(
          "⊘ Skipping - amount too small, likely noise:",
          data.amount
        );
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

// NEW: Fetch attachment data if needed
async function getImageData(imageInfo, messageId, token) {
  if (imageInfo.data) {
    // Already have inline data
    return imageInfo;
  }

  if (imageInfo.attachmentId) {
    try {
      console.log("Fetching attachment:", imageInfo.attachmentId);
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${imageInfo.attachmentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        console.error("Failed to fetch attachment:", response.status);
        return null;
      }

      const attachmentData = await response.json();
      return {
        mimeType: imageInfo.mimeType,
        data: attachmentData.data.replace(/-/g, "+").replace(/_/g, "/"),
        filename: imageInfo.filename,
      };
    } catch (error) {
      console.error("Error fetching attachment:", error);
      return null;
    }
  }

  return null;
}

async function analyzeReceiptImage(imageData, subject, from, date, apiKey) {
  if (!imageData || !imageData.mimeType || !imageData.data) {
    console.warn("No valid image data available, skipping vision analysis");
    return null;
  }

  const prompt = `Analyze this receipt image and extract transaction details. Return ONLY valid JSON with no markdown or extra text.

Context:
- Email Subject: ${subject}
- From: ${from}
- Email Date: ${date}

Extract these fields from the receipt image:
- merchant: Company/store name
- date: Transaction date in YYYY-MM-DD format (look for order date, purchase date, trip date)
- amount: Total amount paid as a number with 2 decimal places (e.g., 414.20 not 7)
- category: One of: "food", "groceries", "shopping", "travel", "entertainment", "other"
- currency: "INR" for ₹/Rs or "USD" for $

Rules:
- Look carefully at the receipt for FULL total amount including decimals
- Use the transaction date from the receipt, not the email date
- If merchant not clear from image, extract from email sender
- Return ONLY JSON: {"merchant": "...", "date": "...", "amount": 414.20, "category": "...", "currency": "INR"}

Example: {"merchant": "Uber", "date": "2025-09-15", "amount": 245.50, "category": "travel", "currency": "INR"}`;

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
          maxOutputTokens: 300,
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

  if (!aiResponse.match(/^\s*\{(?:[^{}]|(?:\{[^{}]*\}[^{}]*))*\}\s*$/)) {
    console.warn("Non-JSON response from vision, skipping:", aiResponse);
    return null;
  }

  console.log("Vision AI Response:", aiResponse);
  return JSON.parse(aiResponse);
}

async function analyzeReceiptText(
  body,
  subject,
  from,
  date,
  apiKey,
  retryCount = 0
) {
  const prompt = `You are an AI designed to extract receipt/order details from email text. Return ONLY a valid JSON object with NO additional text, explanations, markdown, or narrative. Extract the following fields:
- merchant: The company/store name (e.g., "Amazon", "Swiggy", "Uber") or sender domain if unclear
- date: The ACTUAL transaction/order date in YYYY-MM-DD format (NOT the email received date unless no other date is found)
- amount: The total amount as a number with decimals (e.g., 414.20) from "Total", "Amount Paid", etc.
- category: One of: "food", "groceries", "shopping", "travel", "entertainment", "other"
- currency: "INR" if ₹/Rs/INR found, "USD" if $/USD found, "INR" if unclear

Rules:
- If merchant is unclear, use the sender domain (from email) or "Unknown"
- If date is missing, use "${date}"
- If amount is missing or unclear, use 0
- Output MUST be a single JSON object with exactly these fields
- Do NOT include any text outside the JSON object

Email Subject: ${subject}
From: ${from}
Email Date: ${date}
Body: ${body}

Example: {"merchant": "Uber", "date": "2025-10-03", "amount": 245.50, "category": "travel", "currency": "INR"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          topP: 0.8,
          maxOutputTokens: 200,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    // Handle rate limiting with retry
    if (response.status === 429 && retryCount < 3) {
      const retryAfter = 20; // Wait 20 seconds for rate limit
      console.warn(
        `Rate limited. Retrying in ${retryAfter}s... (attempt ${
          retryCount + 1
        }/3)`
      );
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return analyzeReceiptText(
        body,
        subject,
        from,
        date,
        apiKey,
        retryCount + 1
      );
    }

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

  if (!aiResponse.match(/^\s*\{(?:[^{}]|(?:\{[^{}]*\}[^{}]*))*\}\s*$/)) {
    console.warn("Non-JSON response, attempting to extract:", aiResponse);
    const jsonMatch = aiResponse.match(
      /^\s*\{(?:[^{}]|(?:\{[^{}]*\}[^{}]*))*\}\s*$/
    );
    if (jsonMatch) {
      aiResponse = jsonMatch[0].trim();
    } else {
      console.error("No valid JSON found in response");
      return null;
    }
  }

  try {
    const data = JSON.parse(aiResponse);
    console.log("Text AI Response:", aiResponse);
    return data;
  } catch (e) {
    console.warn(
      "Extracted JSON is invalid, falling back:",
      e.message,
      "Response:",
      aiResponse
    );
    return null;
  }
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

// NEW: Aggressive plain text extraction function
function extractFromPlainText(text, subject, from, emailDate) {
  if (!text) return null;

  try {
    // Convert HTML to plain text if needed
    const plainText = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

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

    let currency = "INR";
    if (
      plainText.includes("₹") ||
      /rs\.?/i.test(plainText) ||
      /inr/i.test(plainText)
    )
      currency = "INR";
    else if (plainText.includes("$") || /usd/i.test(plainText))
      currency = "USD";

    // Look for amounts with various formats
    const amounts = [];
    const amountPatterns = [
      // Priority patterns with explicit labels
      /(?:total\s*paid|total\s*fare|total\s*amount|grand\s*total|amount\s*paid|you\s*paid|trip\s*total|bill\s*amount|order\s*total)[:\s]*(₹|rs\.?|inr|\$)?\s*([\d,]+\.[\d]{2})/gi,
      // Standalone amounts near keywords
      /(?:total|paid|fare|amount|charge|bill)[^\d]{0,30}(₹|rs\.?|inr|\$)\s*([\d,]+\.[\d]{2})/gi,
      /(?:total|paid|fare|amount|charge|bill)[^\d]{0,30}([\d,]+\.[\d]{2})\s*(₹|rs\.?|inr|\$)?/gi,
    ];

    for (let pattern of amountPatterns) {
      let match;
      while ((match = pattern.exec(plainText)) !== null) {
        // Extract amount - could be in match[2] or match[1] depending on pattern
        const amountStr = (match[2] || match[1]).replace(/,/g, "");
        const amount = parseFloat(amountStr);

        if (amount >= 10 && amount < 100000) {
          const hasLabel = /total|paid|fare|amount/i.test(
            match[0].substring(0, 30)
          );
          const priority = hasLabel ? 3 : 1;

          amounts.push({
            value: amount,
            priority: priority,
            source: match[0].substring(0, 50),
          });
        }
      }
    }

    console.log(
      "Plain text amounts found:",
      amounts.map((a) => `₹${a.value} [P${a.priority}]`)
    );

    let category = "other";
    if (/uber|ola|taxi|cab|ride/i.test(plainText) || /uber|ola/i.test(from))
      category = "travel";
    else if (
      /swiggy|zomato|food|restaurant|delivery/i.test(plainText) ||
      /swiggy|zomato/i.test(from)
    )
      category = "food";
    else if (
      /amazon|flipkart|shopping|order|product/i.test(plainText) ||
      /amazon|flipkart/i.test(from)
    )
      category = "shopping";
    else if (/blinkit|grofer|grocery/i.test(plainText)) category = "groceries";

    if (amounts.length > 0) {
      amounts.sort((a, b) => b.priority - a.priority || b.value - a.value);
      const bestAmount = amounts[0];
      console.log(
        "✓ Plain text extracted:",
        bestAmount.value,
        "from:",
        bestAmount.source
      );

      return {
        merchant,
        date: emailDate,
        amount: bestAmount.value,
        category,
        currency,
      };
    }

    return null;
  } catch (error) {
    console.error("Error in plain text extraction:", error);
    return null;
  }
}

// IMPROVED: Better promotional email detection
function isPromotionalEmail(subject, html, from) {
  const promoKeywords = [
    /want \d+% off/i,
    /save up to/i,
    /get \d+% off/i,
    /discount/i,
    /limited time/i,
    /special deal/i,
    /exclusive offer/i,
  ];

  // Concert/event emails from Spotify
  if (
    from.includes("spotify.com") &&
    (subject.toLowerCase().includes("concert") ||
      subject.toLowerCase().includes("live:") ||
      subject.toLowerCase().includes("tour"))
  ) {
    return true;
  }

  // Recruitment/job application emails (no financial transactions)
  if (
    subject.toLowerCase().includes("application") ||
    subject.toLowerCase().includes("consent received") ||
    subject.toLowerCase().includes("position at") ||
    subject.toLowerCase().includes("job") ||
    subject.toLowerCase().includes("recruitment")
  ) {
    return true;
  }

  const subjectLower = subject.toLowerCase();
  for (let keyword of promoKeywords) {
    if (keyword.test(subjectLower)) {
      return true;
    }
  }

  // Strong receipt indicators override promo detection
  if (
    /receipt|invoice|order confirmation|trip with|your.*trip|payment received/i.test(
      subject
    )
  ) {
    return false;
  }

  return false;
}

// IMPROVED: Better HTML amount extraction
function extractFromHTML(html, subject, from, emailDate) {
  if (!html) return null;
  try {
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

    let amounts = [];
    let currency = "INR";
    if (html.includes("₹") || /rs\.?/i.test(html) || /inr/i.test(html))
      currency = "INR";
    else if (html.includes("$") || /usd/i.test(html)) currency = "USD";

    // IMPROVED: More precise amount patterns that avoid URLs
    const amountPatterns = [
      // High priority: explicit labels with amounts (various formats)
      /(?:total paid|grand total|total amount|order total|trip total|amount paid|bill amount|you paid|total fare|fare)[\s:]*(?:₹|rs\.?|inr)?\s*([\d,]+\.[\d]{2})/gi,
      /(?:total paid|grand total|total amount|order total|trip total|amount paid|bill amount|you paid|total fare|fare)[\s:]*\$\s*([\d,]+\.[\d]{2})/gi,

      // Medium priority: currency symbols with spaces/formatting variations
      /(?:₹|rs\.?|inr)\s*([\d,]+\.[\d]{2})/gi,
      /\$\s*([\d,]+\.[\d]{2})/gi,

      // Lower priority: standalone decimal amounts near financial keywords (within 100 chars)
      /(?:total|paid|amount|fare|charge)[^\d₹$]{0,50}([\d,]+\.[\d]{2})/gi,
    ];

    for (let pattern of amountPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);

        // Only accept reasonable amounts (₹10 to ₹100,000)
        if (amount >= 10 && amount < 100000) {
          const hasDecimals =
            amountStr.includes(".") && amountStr.split(".")[1].length === 2;

          // Get context around the match (100 chars before and after)
          const contextStart = Math.max(0, match.index - 100);
          const contextEnd = Math.min(
            html.length,
            match.index + match[0].length + 100
          );
          const context = html.substring(contextStart, contextEnd);

          // Check if it's in a URL or href attribute
          const isInUrl =
            /https?:\/\/[^\s"'<>]{0,100}/.test(context) ||
            /href=["'][^"']{0,100}/.test(context) ||
            /src=["'][^"']{0,100}/.test(context);

          if (!isInUrl) {
            // Determine priority based on pattern and context
            let priority = 1;
            if (
              match[0].match(
                /total paid|grand total|total amount|trip total|you paid|total fare/i
              )
            ) {
              priority = 3; // Highest priority for explicit total labels
            } else if (hasDecimals) {
              priority = 2; // Medium priority for amounts with decimals
            }

            amounts.push({
              value: amount,
              priority: priority,
              source: match[0],
              context: context.substring(0, 80), // Store snippet for debugging
            });
          }
        }
      }
    }

    console.log(
      "Found amounts in HTML:",
      amounts.map(
        (a) => `₹${a.value} [P${a.priority}] (${a.source.substring(0, 30)})`
      )
    );

    let transactionDate = emailDate;
    const datePatterns = [
      /(?:trip|order|purchased|delivered|paid)\s+(?:on|at)?\s*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
      /(?:trip|order|purchased|delivered|paid)\s+(?:on|at)?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)/gi,
      /trip date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
      /order date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/gi,
    ];
    for (let pattern of datePatterns) {
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

    let category = "other";
    if (/uber|ola|taxi|cab|ride/i.test(html) || /uber|ola/i.test(from))
      category = "travel";
    else if (
      /swiggy|zomato|food|restaurant|delivery/i.test(html) ||
      /swiggy|zomato/i.test(from)
    )
      category = "food";
    else if (
      /amazon|flipkart|shopping|order|product/i.test(html) ||
      /amazon|flipkart/i.test(from)
    )
      category = "shopping";
    else if (/blinkit|grofer|grocery/i.test(html)) category = "groceries";

    if (amounts.length > 0) {
      amounts.sort((a, b) => b.priority - a.priority || b.value - a.value);
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

    // FALLBACK: If no amounts found but looks like a receipt, try aggressive plain text extraction
    if (/receipt|invoice|trip|order/i.test(subject)) {
      console.log("Trying fallback plain text extraction...");
      const plainText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

      // Look for common receipt amount patterns in plain text
      const fallbackPatterns = [
        /total[:\s]*(₹|rs\.?|inr)?\s*([\d,]+\.[\d]{2})/gi,
        /paid[:\s]*(₹|rs\.?|inr)?\s*([\d,]+\.[\d]{2})/gi,
        /amount[:\s]*(₹|rs\.?|inr)?\s*([\d,]+\.[\d]{2})/gi,
        /fare[:\s]*(₹|rs\.?|inr)?\s*([\d,]+\.[\d]{2})/gi,
      ];

      const fallbackAmounts = [];
      for (let pattern of fallbackPatterns) {
        let match;
        while ((match = pattern.exec(plainText)) !== null) {
          const amountStr = match[2].replace(/,/g, "");
          const amount = parseFloat(amountStr);
          if (amount >= 10 && amount < 100000) {
            fallbackAmounts.push({
              value: amount,
              source: match[0],
            });
          }
        }
      }

      if (fallbackAmounts.length > 0) {
        // Take the largest amount as likely total
        fallbackAmounts.sort((a, b) => b.value - a.value);
        const fallbackAmount = fallbackAmounts[0];
        console.log(
          "✓ Fallback extracted:",
          fallbackAmount.value,
          "from:",
          fallbackAmount.source
        );
        return {
          merchant,
          date: transactionDate,
          amount: fallbackAmount.value,
          category,
          currency,
        };
      }
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
      if (
        part.mimeType &&
        (part.mimeType.startsWith("image/") ||
          part.mimeType === "application/pdf")
      ) {
        if (part.body?.attachmentId) {
          console.log("Found attachment:", part.filename, part.mimeType);
          images.push({
            mimeType: part.mimeType,
            attachmentId: part.body.attachmentId,
            filename: part.filename,
          });
        } else if (part.body?.data) {
          images.push({
            mimeType: part.mimeType,
            data: part.body.data.replace(/-/g, "+").replace(/_/g, "/"),
            filename: part.filename || "inline",
          });
          console.log(
            "Found inline content:",
            part.filename || "inline",
            part.mimeType
          );
        }
      }
      if (part.parts) processParts(part.parts);
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
  if (isNaN(date.getTime()) || date > new Date()) {
    return fallbackDate || new Date().toISOString().split("T")[0];
  }
  return date.toISOString().split("T")[0];
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

chrome.storage.local.get(['extractedData', 'lastScanned'], (result) => {
  if (chrome.runtime.lastError) {
  console.error('Error retrieving data:', chrome.runtime.lastError);
    return;
  }

  const allReceipts = result.extractedData;
  const scanTimestamp = result.lastScanned;

  if (allReceipts) {
    console.log('Successfully retrieved receipts:', allReceipts);
    console.log('Last scanned on:', new Date(scanTimestamp));
    // You can now use the 'allReceipts' variable.
  } else {
    console.log('No receipt data found in local storage.');
  }
});