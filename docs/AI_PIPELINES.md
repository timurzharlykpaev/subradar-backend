# SubRadar AI — AI Pipelines

## Overview

All AI features use OpenAI GPT-4o. Each pipeline has a specific input, structured output, and confidence scoring.

## Pipeline 1: Text Parser

### Input
User's natural language text, e.g.:
> "ChatGPT Plus $20/month, billing on 15th, Kaspi card 4242"

### Process
1. Send text to GPT-4o with structured output schema
2. Extract fields: name, amount, currency, billingPeriod, nextBillingDate, trialInfo, cardMention, category
3. Calculate confidence score based on how many fields were reliably extracted
4. If confidence < 0.5: return with `clarificationNeeded: true` and list of questions
5. If confidence >= 0.5: return parsed subscription data

### Output
```json
{
  "confidence": 0.92,
  "parsed": {
    "name": "ChatGPT Plus",
    "amount": 20,
    "currency": "USD",
    "billingPeriod": "MONTHLY",
    "nextBillingDate": "2026-03-15",
    "category": "AI_SERVICES",
    "status": "ACTIVE"
  },
  "clarificationNeeded": false,
  "questions": []
}
```

### Prompt Design
- System prompt defines all possible fields and their types
- Include example inputs and expected outputs
- Ask model to return confidence per field
- If a field can't be determined, return null (not a guess)

## Pipeline 2: Screenshot Parser

### Input
Image file (JPEG/PNG) — screenshot of billing email, payment page, subscription confirmation, receipt.

### Process
1. Upload image to GPT-4o vision
2. Extract: service name, amount, currency, billing period, date, plan, trial info, website/domain
3. Calculate confidence
4. Match extracted service name against known services DB
5. Suggest icon if service matched

### Output
Same shape as text parser output, plus:
```json
{
  "matchedService": {
    "id": "netflix",
    "name": "Netflix",
    "iconUrl": "https://...",
    "website": "netflix.com"
  }
}
```

### Notes
- Image must be resized to max 2048px before sending to API (cost optimization)
- Store original image in DO Spaces temporarily (24h TTL) for debugging
- If OCR fails completely, return `clarificationNeeded: true` with empty parsed data

## Pipeline 3: Service Matcher

### Input
Service name string (from user input or AI extraction).

### Process
1. Fuzzy match against internal known services database
2. Check aliases (e.g., "GPT" -> "ChatGPT", "DO" -> "DigitalOcean")
3. Return top 3 matches with confidence scores
4. Include icon URL and website for each match

### Output
```json
{
  "matches": [
    { "id": "chatgpt", "name": "ChatGPT", "confidence": 0.95, "iconUrl": "...", "website": "chat.openai.com" },
    { "id": "openai-api", "name": "OpenAI API", "confidence": 0.6, "iconUrl": "...", "website": "platform.openai.com" }
  ]
}
```

### Known Services DB
- Internal PostgreSQL table or JSON file with ~500 popular services
- Fields: id, name, aliases[], category, iconUrl, website, defaultPlans[]
- Updated periodically

## Pipeline 4: Insight Generator

### Input
User's full subscription list.

### Process
1. Analyze all active subscriptions
2. Detect duplicates (same service, similar services)
3. Calculate potential savings (unused trials, expensive plans with cheaper alternatives)
4. Identify spending patterns (category concentration, growth trend)
5. Generate human-readable insights

### Output
```json
{
  "estimatedMonthlySavings": 15.99,
  "duplicates": [
    { "subscriptionIds": ["uuid1", "uuid2"], "reason": "Both are streaming video services" }
  ],
  "insights": [
    { "type": "EXPENSIVE_CATEGORY", "category": "AI_SERVICES", "monthlyTotal": 60 },
    { "type": "TRIAL_ENDING", "subscriptionId": "uuid3", "daysLeft": 3 }
  ]
}
```

## Pipeline 5: Audit Generator

### Input
User's subscription history for the month.

### Process
1. Compare current month vs previous month
2. Identify new subscriptions, cancelled subscriptions, price changes
3. Run duplicate detection
4. Run savings analysis
5. Compile into structured audit report
6. Generate PDF via PDFKit (async BullMQ job)

### Output
Structured audit stored in Reports table, PDF uploaded to DO Spaces.

## Error Handling

All AI pipelines follow these rules:
1. Timeout: 30 seconds max per API call
2. Retry: 1 retry on timeout or 5xx error
3. Fallback: If AI fails, return error with `fallbackToManual: true`
4. Logging: All AI calls logged to audit module with input/output/confidence
5. Cost tracking: Log token usage per call for billing monitoring

## Rate Limiting
- Free users: no AI features
- Pro users: 50 AI calls per day (text + screenshot combined)
- Team users: 200 AI calls per day per workspace
