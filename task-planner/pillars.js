/* ==========================================================================
   PILLARS — the 6 fixed strategic competency areas that make up the road
   toward the final objective. These are preset, not user-created: they're
   the shape of the job, not a to-do list the user invents.
   ========================================================================== */

const FINAL_OBJECTIVE = "Become COO of C-Pharma";

const PILLARS = [
  {
    id: "commercial",
    short: "Commercial",
    name: "Commercial Leadership",
    blurb: "Revenue growth, gross contribution, basket size, customer conversion, loyalty, business development, new revenue streams.",
    focusAreas: [
      "Revenue growth",
      "Gross contribution",
      "Basket size",
      "Customer conversion",
      "Loyalty",
      "Business development",
      "New revenue streams",
    ],
  },
  {
    id: "financial",
    short: "Financial",
    name: "Financial Acumen",
    blurb: "P&L ownership, COGS / GC%, working capital, inventory optimisation, budgeting, ROI, CAPEX/OPEX, forecasting.",
    focusAreas: [
      "P&L ownership",
      "COGS / GC%",
      "Working capital",
      "Inventory optimisation",
      "Budgeting",
      "ROI",
      "CAPEX/OPEX",
      "Forecasting",
    ],
  },
  {
    id: "operational",
    short: "Operational",
    name: "Operational Excellence",
    blurb: "SOPs, productivity, service levels, process optimisation, automation, stock management, DDMRP, benchmarking.",
    focusAreas: [
      "SOPs",
      "Productivity",
      "Service levels",
      "Process optimisation",
      "Automation",
      "Stock management",
      "DDMRP",
      "Benchmarking",
    ],
  },
  {
    id: "people",
    short: "People",
    name: "People Leadership",
    blurb: "Team structure, talent development, performance management, succession planning, culture, difficult conversations, leadership communication.",
    focusAreas: [
      "Team structure",
      "Talent development",
      "Performance management",
      "Succession planning",
      "Culture",
      "Difficult conversations",
      "Leadership communication",
    ],
  },
  {
    id: "strategic",
    short: "Strategic",
    name: "Strategic Leadership",
    blurb: "Business strategy, new pharmacy/business models, cross-functional projects, healthcare ecosystem, supplier strategy, change management, executive decision-making.",
    focusAreas: [
      "Business strategy",
      "New pharmacy/business models",
      "Cross-functional projects",
      "Healthcare ecosystem",
      "Supplier strategy",
      "Change management",
      "Executive decision-making",
    ],
  },
  {
    id: "presence",
    short: "Presence",
    name: "Executive Presence",
    blurb: "CEO/COO communication, presenting recommendations, data storytelling, negotiation, influencing without authority, executive-level thinking, visibility with senior leadership.",
    focusAreas: [
      "CEO/COO communication",
      "Presenting recommendations",
      "Data storytelling",
      "Negotiation",
      "Influencing without authority",
      "Executive-level thinking",
      "Visibility with senior leadership",
    ],
  },
];

const PILLAR_BY_ID = Object.fromEntries(PILLARS.map((p) => [p.id, p]));

const QUADRANTS = [
  { id: "ui", label: "Important & Urgent", verb: "Do now", accent: "do" },
  { id: "inu", label: "Important & Not Urgent", verb: "Schedule", accent: "schedule" },
  { id: "uni", label: "Urgent & Not Important", verb: "Delegate", accent: "delegate" },
  { id: "neither", label: "Neither", verb: "Drop", accent: "drop" },
];

const QUADRANT_BY_ID = Object.fromEntries(QUADRANTS.map((q) => [q.id, q]));
