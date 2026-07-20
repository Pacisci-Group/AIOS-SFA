# **Technical Specification: Insurance Agency Form Pipeline**

**Document Version:** 2.0

**Target Audience:** CTO / Engineering Leadership

**Project:** Custom Next.js Form Pipeline (Fillout Migration)

## **1\. Executive Summary**

This document outlines the technical requirements and data architecture for migrating our form workflow from Fillout to a custom Next.js frontend application. The system handles the client lifecycle across three distinct phases: **Lead Entry**, **Quote Recap**, and **Sold Finalization**, concluding with an automated **Post-Sale Audit** generation.

Because users may complete these steps days apart, the architecture relies on an **Entity-Driven Flow**. Each form operates in an isolated session, retrieving necessary context via URL parameters (householdId, quoteId) and communicating with the backend API.

## **2\. Core Entities & Data Architecture**

The pipeline relies on four primary data entities:

* **Household:** The foundational unit, containing physical location and all associated individuals (contacts).  
* **Quote:** Proposal details linked to a specific Household.  
* **Sold Deal:** Final execution metrics linked to a Household. Can contain multiple **Sold Policies**.  
* **Audit Record:** A compliance checklist automatically generated upon the creation of a Sold Deal, containing dynamic requirements based on policy and discount types.

## **3\. Form Specifications & Data Requirements**

### **Phase 1: New Lead Form (Entry Point)**

**Purpose:** Establish the core Household identity and capture all relevant parties.

**Session Strategy:** Initiates the data chain.

* **Required Data Inputs:**  
  * **Primary Contact:** First Name, Last Name, Date of Birth, Phone Number, Email.  
  * **Household Address:** Physical living address (distinct from insured property addresses).  
  * **Additional Contacts (Dynamic Array):** Ability to add $N$ number of members. Requires First Name, Last Name, DOB, and Relationship (Enum: Spouse, Child, Driver, Additional Named Insured).  
* **System Action:**  
  * POST /api/households \-\> Returns householdId (UUID/Hash).

### **Phase 2: Quote Recap Form (The Proposal)**

**Purpose:** Document the proposed policies, pricing, and upload physical quote files.

**Session Strategy:** Accessed via /quote?householdId={ID}. Fetches Household data on mount.

* **Required Data Inputs:**  
  * **Policy Types Quoted:** Multi-select.  
  * **Premium & Items:** Dollar amount per policy and item count.  
  * **Property Address (Conditional):** If Home/Renters/Landlord. Includes "Same as Household Address" toggle.  
  * **Documentation:** File upload blob/reference for the Quote Document.  
  * **Metadata:** Free-text Notes.  
* **System Action:**  
  * POST /api/quotes \-\> Returns quoteId.

### **Phase 3: Sold Form (Multi-Step Wizard)**

**Purpose:** Capture detailed execution metrics, validate policy uniqueness, and trigger audit flags.

**Session Strategy:** Accessed via /sold?householdId={ID}. Operates as a multi-step "Card" wizard allowing for array building (multiple policies per submission).

* **Card 1: Sold Date**  
  * Input: Global Sold Date for the deal.  
* **Card 2: Policy Type Selection**  
  * Input: Select single policy type to enter (e.g., Auto, Home).  
* **Card 3: Basic Policy Details**  
  * Inputs: Start Date, Carrier, Policy Number.  
  * *System Action:* Must perform a GET /api/policies/check?number={policyNumber}. If a match is found, prompt user to select and edit existing policy to prevent duplicates.  
* **Card 4: Policy Financials**  
  * Inputs: Premium amount, Number of Items.  
* **Card 5: Discounts & Required Documentation (Highly Conditional)**  
  * *If Home/Landlord:* Options for Escrow Payment, Fire Subscription, Roof Receipt.  
    * **Escrow:** If checked \-\> Display required Escrow Card (Loan Number, Escrow Company Name, Address).  
    * **Fire/Roof:** If checked \-\> Prompt: "Do you have proof?" (Yes \= File Upload; No \= Send to Audit).  
  * *If Auto:* Options for Drivewise, Defensive Driver, Student Discount.  
    * **Drivewise:** If checked \-\> Send to Audit (Service to mention registration).  
    * **Defensive Driver:** If checked \-\> User selects drivers. If drivers missing, display sub-card to add drivers. Send all selected drivers to Audit to capture certificate.  
    * **Student:** If checked \-\> Prompt: "Do you have report card/transcript?" (Yes \= File Upload; No \= Send to Audit).  
* **Card 6: Prior Insurance**  
  * Inputs: Prior Carrier, Prior Agent.  
  * Logic: Must dynamically match policy type (e.g., "Prior Auto Insurance"). Must include a "No prior \[Type\] insurance" toggle.  
* **Card 7: Cancellation**  
  * Inputs: "Did you cancel the prior insurance?" (Yes/No). If Yes \-\> Select effective date of cancellation.  
* **Card 8: Loop Control**  
  * Prompt: "Do you want to add another policy?"  
  * Logic: If Yes, loop back to Card 2\. If No, compile array of policies and submit.  
* **System Action:**  
  * POST /api/sold-deals  
  * **Trigger:** Successful response automatically initiates the Post-Sale Audit protocol.

## **4\. Post-Sale Audit Pipeline**

**Purpose:** An automated tracking mechanism for the office manager and service team post-sale.

**Trigger:** Fires asynchronously immediately after the Sold Form submission. **System Action:** POST /api/audit-records

**Dynamic Verification Flags (Generated based on Card 5 selections):**

1. **Escrow Check:** If Escrow was submitted, verify Loan Number, Company, and Address.  
2. **Inspection Verification:** Home policies check for "Passed" or "Waived".  
3. **Missing Proof of Discounts (Home):** Flags for missing Fire Subscription or Roof Receipt uploads.  
4. **Auto Tracking \- Drivewise:** Flag for Service team to mention registration.  
5. **Auto Tracking \- Defensive Driver:** Flag to collect certificates for all specifically selected drivers.  
6. **Auto Tracking \- Student:** Flag for missing report card/transcript uploads.  
7. **Fire Subscription Receipt** \- Home, Landlord and Rental  
8. **New Roof Receipt** \- Home and Landlord 