## 

## 

# **Project Architecture: Insurance Agency Form Pipeline**

## Project Overview

We are transitioning away from Fillout to build a custom, highly scalable form pipeline using Next.js. This system will handle the entire lifecycle of a client: Lead Entry ![][image1] Quote Recap ![][image2] Sold Finalization ![][image3] Post-Sale Audit.

Because a user might enter a lead on Monday, quote it on Wednesday, and sell it on Friday, each form must operate in a completely separate session. State cannot simply be held in the frontend (like a standard wizard form). Data will be passed between forms via URL parameters and fetched from the backend.

## UI/UX Inspiration

CRITICAL NOTE FOR SOLD FORM: The styling, structure, and flow of the Sold Form should heavily mimic the user experience found at lead.okinsuranceexchange.com or rce.okinsuranceexchange.com. Keep the design clean, modular, and professional.

## Tech Stack & Coding Standards

* **Framework:** Next.js (App Router), React, TypeScript (Strict mode).  
* **Styling:** Tailwind CSS. **Rule:** Do NOT use @apply in CSS files. Use clsx and tailwind-merge (via a cn utility) for all dynamic classes.  
* **Forms & Validation:** TanStack Form paired with zod (via Standard Schema — the zod schema is passed straight to `validators`, no resolver package) for strict type safety and field validation. Build on the shared `useAppForm` hook and the field components in `src/components/form/fields/`; field components take a field-path prop and never hardcode a path.  
* **Architecture:** Adhere to functional components with named exports. Keep UI components modular in src/components/ui/.

## Data Flow & Mock Environment

Since the Node backend is not yet built, you must build a Mock API using localStorage to simulate database operations and network delays.

* **Lead Session:** Creates a Household ![][image4] Returns householdId.  
* **Quote Session:** Reads ?householdId=123 ![][image5] Creates Quote ![][image6] Returns quoteId.  
* **Sold Session:** Reads ?householdId=123\&quoteId=456 ![][image7] Creates SoldDeal AND auto-generates a pending AuditRecord.

## Form Specifications

### 1\. New Lead Form (The Entry Point)

* **Purpose:** Establishes the Household entity.  
* **Fields:**  
  * Primary Contact (First Name, Last Name, DOB, Phone, Email).  
  * Household Address (Where they live, independent of property policies).  
  * Dynamic Field Array for Additional Contacts (Spouse, Child, Driver, Additional Named Insured \- capturing Name, DOB, Relationship).  
* **Action:** Submit to Mock API createHousehold.

### 2\. Quote Recap Form (The Proposal)

* **Purpose:** Captures policy specifics.  
* **Context:** Reads householdId from the URL.  
* **Fields:**  
  * Policy Type(s) Quoted (Multi-select).  
  * Premium amount per policy & Item count.  
  * Property Address (Conditional: Only if Home/Renters/Landlord is selected). Must include a **"Same as Household Address"** toggle that auto-fills based on the fetched household data.  
  * Notes (Textarea) and Quote Document (Mock File Dropzone).  
* **Action:** Submit to Mock API createQuote tied to the householdId.

### 3\. Sold Form (The Finalization)

* **Purpose:** Captures execution details to bind the policy.  
* **Context:** Reads householdId and optional quoteId from the URL. **UI must resemble lead.okinsuranceexchange.com.**  
* **Fields:**  
  * Sold Date, Policy Type(s) Sold, Policy Number(s), Start Date.  
  * Prior Insurance Information.  
  * Discounts Applied.  
  * Escrow Information (Conditional for Home/Landlord): Loan Number, Escrow Company, Escrow Address.  
* **Action:** Submit to Mock API createSoldDeal.

### 4\. Post-Sale Audit (Background Process)

* **Purpose:** Tracking and compliance for the office manager.  
* **Action:** Immediately upon successful submission of the Sold Form, the system must sequentially trigger createAuditRecord.  
* **Details:** This creates a pending checklist entity in the database with default pending/unverified boolean flags for:  
  * Escrow Details Verified  
  * Inspection Passed/Waived  
  * Drivers/Additional Insureds Documented  
  * Discount Proof Attached

## 

![][image8]

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAAeUlEQVR4XmNgGAWjYOCBvLx8K7oYxUBBQcFDSUmJH12cYgB07UVFRUV5dHGKANDQWUC8B10cDoCS06CKSMJycnILgPQvIO5DN5M2hpIDxMXFuYGGLZaWlpZBlyMbAA28QtWIAiUnoKFB6OIUAXkaJX4FdLFRMApoCADLri0q8MCj7gAAAABJRU5ErkJggg==>

[image8]: <data:image/png;base64,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>