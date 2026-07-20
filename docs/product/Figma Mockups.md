To help save you time and streamline your sprint planning, here is a high-level breakdown of the core engineering patterns, design tokens, and logic implemented across these views:

### **1\. The Design System & Themes**

* **Tokens:** The UI is built using the **Allstate color identity** (Deep Trust Blues, Emerald Success Greens, Sky Action Blues, and Amber Alert states).  
* **Dual Theme:** We have fully mapped out both **Light Mode** and **Dark Mode** variations. Please check the typography and color token contrast ratios inside Figma to ensure native CSS variables map perfectly between both themes.

### **2\. Change to Permission Based Logic (Currently RBAC)** 

The application relies heavily on Role-Based Access Control. As discussed in our meeting last week we are changing over to permission based logic. So make necessary adjustments for this. Each view should change dynamically based on the logged-in user:

* **Sales Producer Dashboard:** Displays user-specific performance data *only*, but links to a shared global agency leaderboard.  
* **Service Dashboard:** Focuses on queue prioritization, SLA management, and proactive retention windows.  
* **Management & Ownership Dashboards:** Default to aggregated macro-agency health metrics with quick drill-down capabilities.

### **3\. Dynamic Data Patterns (Critical UX Upgrades)**

Please note that we are completely moving away from static tables and manual pagination:

* **Fuzzy Search:** The global top navigation features an omni-search command bar that should fetch matches in real time as the user types.  
* **Real-Time Faceted Filtering:** All date ranges (Today, Week, Month, Custom) and dropdown components are interactive tags. Selecting a tag should lazily update the data container below **instantly, without requiring an "Apply Filters" button click.**  
* **Data Masking:** All underlying database cryptographic hashes (like Household IDs or Ticket strings) must be masked with human-readable hyperlink labels or strings (e.g., `TKT-2026-004`) to reduce visual noise.

### **4\. Layout Architecture**

I have optimized the workspace using an asymmetrical **60/40 or 3-column split layout** on major detail pages (Leads, Households, CRM Tickets). This eliminates vertical scroll fatigue by keeping the core workspace fixed to the center and actions contextually docked to the right/left.

