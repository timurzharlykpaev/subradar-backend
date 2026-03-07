<!-- SHARED: subradar-backend, subradar-web, subradar-mobile -->
<!-- Canonical: subradar-backend/docs/AI_BEHAVIOR.md -->
<!-- Synced: 2026-03-07 -->

# SubRadar AI — AI Behavior Rules

## AI Roles

AI is not "magic for magic's sake." It has concrete roles:

### 1. AI Text Parser
From user's natural language text, extracts:
- Service name
- Amount
- Currency
- Billing period
- Next billing date
- Trial info
- Card mention
- Category guess

### 2. AI Screenshot Parser
From photo/screenshot, extracts:
- Service name
- Amount
- Currency
- Date
- Plan name
- Trial info
- Probable website/domain

### 3. AI Service Matcher
Determines:
- Which known service this is
- Whether it's the right subscription
- Similar alternatives
- Suggested icon/domain

### 4. AI Insight Generator
Builds:
- Potential savings
- Duplicate alerts
- Expensive category alerts
- Monthly growth explanation
- Unused/overlapping service hints

### 5. AI Audit Generator
Creates monthly reports with:
- Summary
- Changes since last month
- Duplicates found
- Trial risks
- Biggest spenders
- Recommendations

## Confidence Rules

### Rule 1: High confidence (>0.85)
Show nearly complete pre-filled form. User just confirms and saves.

### Rule 2: Medium confidence (0.5-0.85)
Ask 1-3 clarification questions:
- Monthly or yearly?
- Exact amount?
- Trial or active?
- Next billing date?

Do NOT ask unnecessary questions. Do NOT turn the screen into a 20-message chat.

### Rule 3: Low confidence (<0.5)
Offer:
- Multiple service name options
- Manual entry
- Field editing

### Rule 4: Never save silently
Never save critical financial data "silently" when there is doubt.

### Rule 5: Always review before save
After every AI action, user must see a review screen before saving.

## Fallback Behavior

If AI fails completely:
1. Show error message: "Could not reliably recognize subscription"
2. Offer: "Try again" and "Add manually"
3. Never block the user from completing the task

## AI Configuration

- Model: GPT-4o (via OpenAI API)
- Text parsing: structured output with confidence score
- Image parsing: vision model with structured extraction
- Service matching: against internal known services database
- All AI calls are async and should not block UI beyond loading state

## AI in the Interface — UX Rules

1. AI must NOT force user into a long conversation
2. AI's task: quickly recognize -> ask only necessary questions -> lead to confirmation screen
3. Processing state should show: "Analyzing your subscription..." with loader
4. Failed state should always offer manual entry as escape hatch
5. Clarification should be max 1-3 questions, presented as quick-select options (not free text)
