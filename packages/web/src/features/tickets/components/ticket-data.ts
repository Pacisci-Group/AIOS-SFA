export type TicketStatus = "open" | "waiting" | "resolved" | "overdue";
export type TicketCategory =
  | "Renewal Review"
  | "Claims Inquiry"
  | "Premium Dispute"
  | "Policy Change"
  | "Billing Issue"
  | "Coverage Question"
  | "Cancellation Request"
  | "New Business";

export type Priority = "high" | "medium" | "low";

export interface TimelineEntry {
  id: string;
  timestamp: string;
  type: "created" | "note" | "status" | "system" | "call";
  author?: string;
  content: string;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  clientName: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: Priority;
  daysOpen: number;
  assignedRep: string;
  policyNumber: string;
  policyType: string;
  household: string;
  phone: string;
  email: string;
  lastActivity: string;
  timeline: TimelineEntry[];
}

export const TICKETS: Ticket[] = [
  {
    id: "t1",
    ticketNumber: "RENEW-280",
    clientName: "Meredith Dunning",
    category: "Renewal Review",
    status: "open",
    priority: "high",
    daysOpen: 12,
    assignedRep: "Ashley Medina",
    policyNumber: "969893347",
    policyType: "Auto",
    household: "Dunning Household",
    phone: "(512) 874-3301",
    email: "m.dunning@email.com",
    lastActivity: "2 hours ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 9, 2026 — 9:14 AM",
        type: "created",
        content: "Ticket opened. Client called in to review upcoming auto policy renewal — rate increase of $47/mo flagged.",
      },
      {
        id: "tl2",
        timestamp: "Jun 9, 2026 — 9:22 AM",
        type: "system",
        content: "Policy auto-renewal notice sent to client email on file.",
      },
      {
        id: "tl3",
        timestamp: "Jun 9, 2026 — 11:05 AM",
        type: "call",
        author: "Ashley Medina",
        content: "Outbound call placed — no answer. Left voicemail requesting callback to discuss renewal options.",
      },
      {
        id: "tl4",
        timestamp: "Jun 10, 2026 — 2:31 PM",
        type: "note",
        author: "Ashley Medina",
        content: "Client returned call. Explained that the increase is due to a statewide rate adjustment effective Q3. Offered loyalty discount review — submitted to underwriting.",
      },
      {
        id: "tl5",
        timestamp: "Jun 11, 2026 — 8:50 AM",
        type: "status",
        author: "System",
        content: "Status changed: Open → Waiting on Underwriter",
      },
    ],
  },
  {
    id: "t2",
    ticketNumber: "CLAIM-441",
    clientName: "James Okafor",
    category: "Claims Inquiry",
    status: "overdue",
    priority: "high",
    daysOpen: 15,
    assignedRep: "Derek Hollis",
    policyNumber: "774821003",
    policyType: "Home",
    household: "Okafor Household",
    phone: "(737) 200-9912",
    email: "jokafor@gmail.com",
    lastActivity: "1 day ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "May 25, 2026 — 10:00 AM",
        type: "created",
        content: "Claim inquiry opened. Water damage from burst pipe — adjuster visit requested.",
      },
      {
        id: "tl2",
        timestamp: "May 27, 2026 — 3:15 PM",
        type: "note",
        author: "Derek Hollis",
        content: "Adjuster scheduled for June 1st. Client notified.",
      },
    ],
  },
  {
    id: "t3",
    ticketNumber: "BILL-092",
    clientName: "Sandra Krause",
    category: "Billing Issue",
    status: "waiting",
    priority: "medium",
    daysOpen: 5,
    assignedRep: "Ashley Medina",
    policyNumber: "331047829",
    policyType: "Life",
    household: "Krause Household",
    phone: "(214) 556-7740",
    email: "sandrak@outlook.com",
    lastActivity: "4 hours ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 4, 2026 — 11:30 AM",
        type: "created",
        content: "Client reported double charge on June statement. Awaiting billing dept review.",
      },
    ],
  },
  {
    id: "t4",
    ticketNumber: "PCHG-317",
    clientName: "Tom Weatherford",
    category: "Policy Change",
    status: "open",
    priority: "medium",
    daysOpen: 3,
    assignedRep: "Chris Nguyen",
    policyNumber: "882001456",
    policyType: "Auto",
    household: "Weatherford Household",
    phone: "(469) 883-1120",
    email: "tweatherford@yahoo.com",
    lastActivity: "Yesterday",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 6, 2026 — 2:00 PM",
        type: "created",
        content: "Client adding a 2023 Ford F-150 to existing auto policy. Needs updated declaration page.",
      },
    ],
  },
  {
    id: "t5",
    ticketNumber: "PREM-158",
    clientName: "Donna Vasquez",
    category: "Premium Dispute",
    status: "overdue",
    priority: "high",
    daysOpen: 18,
    assignedRep: "Derek Hollis",
    policyNumber: "554390021",
    policyType: "Home",
    household: "Vasquez Household",
    phone: "(832) 447-0033",
    email: "dvasquez@email.com",
    lastActivity: "3 days ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "May 22, 2026 — 9:00 AM",
        type: "created",
        content: "Client disputes 22% premium hike. Requesting detailed breakdown from underwriting.",
      },
    ],
  },
  {
    id: "t6",
    ticketNumber: "CVGQ-511",
    clientName: "Henry Liu",
    category: "Coverage Question",
    status: "waiting",
    priority: "low",
    daysOpen: 2,
    assignedRep: "Ashley Medina",
    policyNumber: "990124873",
    policyType: "Umbrella",
    household: "Liu Household",
    phone: "(713) 660-2244",
    email: "henry.liu@corp.com",
    lastActivity: "6 hours ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 7, 2026 — 4:45 PM",
        type: "created",
        content: "Client asking whether umbrella policy covers rental property liability. Forwarded to senior underwriter.",
      },
    ],
  },
  {
    id: "t7",
    ticketNumber: "CANC-078",
    clientName: "Rachel Simmons",
    category: "Cancellation Request",
    status: "open",
    priority: "high",
    daysOpen: 1,
    assignedRep: "Chris Nguyen",
    policyNumber: "667234190",
    policyType: "Auto",
    household: "Simmons Household",
    phone: "(512) 321-8874",
    email: "rsimmons@gmail.com",
    lastActivity: "30 min ago",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 8, 2026 — 3:10 PM",
        type: "created",
        content: "Client requesting cancellation of auto policy effective June 30. Moving out of state.",
      },
    ],
  },
  {
    id: "t8",
    ticketNumber: "RENEW-301",
    clientName: "Patrick Ellison",
    category: "Renewal Review",
    status: "resolved",
    priority: "low",
    daysOpen: 0,
    assignedRep: "Ashley Medina",
    policyNumber: "445780334",
    policyType: "Home",
    household: "Ellison Household",
    phone: "(817) 993-4451",
    email: "pellison@work.com",
    lastActivity: "Today",
    timeline: [
      {
        id: "tl1",
        timestamp: "Jun 3, 2026 — 8:00 AM",
        type: "created",
        content: "Annual homeowner renewal review initiated.",
      },
      {
        id: "tl2",
        timestamp: "Jun 8, 2026 — 11:00 AM",
        type: "note",
        author: "Ashley Medina",
        content: "Client confirmed renewal. No changes requested.",
      },
      {
        id: "tl3",
        timestamp: "Jun 9, 2026 — 8:30 AM",
        type: "status",
        content: "Ticket resolved — renewal confirmed.",
      },
    ],
  },
];
