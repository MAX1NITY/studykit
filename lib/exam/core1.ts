/**
 * CompTIA A+ Core 1 (220-1201), as the exam actually is.
 *
 * Everything here was looked up rather than recalled, because getting a
 * weighting or an objective number wrong would quietly misdirect months of
 * study. CompTIA's own objectives PDF is the authority; this is a
 * transcription of it.
 */

export const EXAM = {
  code: "220-1201",
  name: "CompTIA A+ Core 1",
  version: "V15",
  /** The real sitting: a maximum of 90 questions in 90 minutes. */
  questions: 90,
  minutes: 90,
  /**
   * Passing is 675 on a 100-900 scale. That scale is CompTIA's own and is
   * not a percentage — it cannot be derived from a count of right answers,
   * so this app never pretends to report it. It shows what it can actually
   * compute: how many were right, and how that broke down by domain.
   */
  passScaled: 675,
  scaleFrom: 100,
  scaleTo: 900,
} as const;

export interface Domain {
  id: string;
  name: string;
  /** Share of the real exam, as a percentage. */
  weight: number;
  objectives: { id: string; title: string }[];
}

export const DOMAINS: Domain[] = [
  {
    id: "1.0",
    name: "Mobile Devices",
    weight: 13,
    objectives: [
      {
        id: "1.1",
        title:
          "Given a scenario, monitor mobile device hardware and use appropriate replacement techniques.",
      },
      {
        id: "1.2",
        title:
          "Compare and contrast accessories and connectivity options for mobile devices.",
      },
      {
        id: "1.3",
        title:
          "Given a scenario, configure basic mobile device network connectivity and provide application support.",
      },
    ],
  },
  {
    id: "2.0",
    name: "Networking",
    weight: 23,
    objectives: [
      {
        id: "2.1",
        title:
          "Compare and contrast Transmission Control Protocol (TCP) and User Datagram Protocol (UDP) ports, protocols, and their purposes.",
      },
      { id: "2.2", title: "Explain wireless networking technologies." },
      { id: "2.3", title: "Summarize services provided by networked hosts." },
      { id: "2.4", title: "Explain common network configuration concepts." },
      {
        id: "2.5",
        title: "Compare and contrast common networking hardware devices.",
      },
      {
        id: "2.6",
        title:
          "Given a scenario, configure basic wired/wireless small office/home office (SOHO) networks.",
      },
      {
        id: "2.7",
        title:
          "Compare and contrast internet connection types, network types, and their characteristics.",
      },
      { id: "2.8", title: "Explain networking tools and their purposes." },
    ],
  },
  {
    id: "3.0",
    name: "Hardware",
    weight: 25,
    objectives: [
      {
        id: "3.1",
        title: "Compare and contrast display components and attributes.",
      },
      {
        id: "3.2",
        title:
          "Summarize basic cable types and their connectors, features, and purposes.",
      },
      { id: "3.3", title: "Compare and contrast RAM characteristics." },
      { id: "3.4", title: "Compare and contrast storage devices." },
      {
        id: "3.5",
        title:
          "Given a scenario, install and configure motherboards, central processing units (CPUs), and add-on cards.",
      },
      {
        id: "3.6",
        title: "Given a scenario, install the appropriate power supply.",
      },
      {
        id: "3.7",
        title:
          "Given a scenario, deploy and configure multifunction devices/printers and settings.",
      },
      {
        id: "3.8",
        title: "Given a scenario, perform appropriate printer maintenance.",
      },
    ],
  },
  {
    id: "4.0",
    name: "Virtualization and Cloud Computing",
    weight: 11,
    objectives: [
      { id: "4.1", title: "Explain virtualization concepts." },
      { id: "4.2", title: "Summarize cloud computing concepts." },
    ],
  },
  {
    id: "5.0",
    name: "Hardware and Network Troubleshooting",
    weight: 28,
    objectives: [
      {
        id: "5.1",
        title:
          "Given a scenario, troubleshoot motherboards, RAM, CPUs, and power.",
      },
      { id: "5.2", title: "Given a scenario, troubleshoot drive and RAID issues." },
      {
        id: "5.3",
        title:
          "Given a scenario, troubleshoot video, projector, and display issues.",
      },
      {
        id: "5.4",
        title: "Given a scenario, troubleshoot common mobile device issues.",
      },
      { id: "5.5", title: "Given a scenario, troubleshoot network issues." },
      { id: "5.6", title: "Given a scenario, troubleshoot printer issues." },
    ],
  },
];

export const DOMAIN_IDS = DOMAINS.map((d) => d.id);

export function domain(id: string): Domain | undefined {
  return DOMAINS.find((d) => d.id === id);
}

/** Every objective id, for validating what the model tags a question with. */
export const OBJECTIVE_IDS = new Set(
  DOMAINS.flatMap((d) => d.objectives.map((o) => o.id)),
);

/**
 * How many questions of a sitting each domain should carry.
 *
 * The weights are percentages that happen to total 100, but a percentage of
 * 90 is rarely a whole number, so the remainder is handed out largest-first
 * rather than left to rounding. The total always comes out exactly right,
 * which matters: a 90-question mock that quietly contains 88 is not the
 * thing it claims to be.
 */
export function domainQuota(total: number): Record<string, number> {
  const exact = DOMAINS.map((d) => ({
    id: d.id,
    raw: (d.weight / 100) * total,
  }));

  const quota: Record<string, number> = {};
  let given = 0;
  for (const { id, raw } of exact) {
    quota[id] = Math.floor(raw);
    given += quota[id];
  }

  // Hand out what rounding dropped, biggest fractional part first.
  const order = [...exact].sort(
    (a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)),
  );
  let i = 0;
  while (given < total) {
    quota[order[i % order.length].id] += 1;
    given += 1;
    i += 1;
  }

  return quota;
}
