const { generateJSON, MODELS } = require('./gemini');

// Generate a few REALISTIC, operator-executable breakfast-promotion ideas for
// the week. The hard constraint (per Jack): only levers a Chick-fil-A franchise
// operator actually controls — NO menu changes, NO price changes, NO corporate
// LTOs. Rewards he can give (free Minis, hash browns, entrée cards to top/lapsed
// app guests), local marketing, community partnerships, and mobile-app offers.

const ALLOWED = [
  'Free reward items loaded to specific guests via the Chick-fil-A App (e.g., free 8-count Chick-n-Minis, free Hash Browns, free Chicken Biscuit) — targeted to top customers, lapsed breakfast guests, or new app members',
  'Mobile-order push / app Spotlight offers for the breakfast daypart',
  'Local community partnerships: schools, offices, gyms, churches, hospitals — breakfast drop-offs, sampling, or catering for AM meetings',
  'Spirit nights / morning fundraisers and early-bird events',
  'In-store and drive-thru signage, lobby sampling, team-member suggestive selling for breakfast',
  'Targeted win-back of guests who used to visit at breakfast but stopped',
];

const FORBIDDEN = [
  'changing, adding, or removing menu items',
  'changing prices or discounting beyond what the operator can normally offer',
  'national limited-time offers or anything requiring corporate approval',
  'anything outside a single franchise operator’s control',
];

async function generateBreakfastIdeas({ location = 'Hanover, PA', context = '', count = 4 } = {}) {
  const prompt = `You are advising a single Chick-fil-A FRANCHISE OPERATOR in ${location} who wants to grow the BREAKFAST daypart this week.

Propose exactly ${count} realistic, specific, executable-THIS-WEEK ideas.

ONLY use levers a Chick-fil-A operator actually controls:
${ALLOWED.map((a, i) => `- ${a}`).join('\n')}

NEVER suggest (these are impossible for an operator):
${FORBIDDEN.map(f => `- ${f}`).join('\n')}

Each idea must tie a concrete reward or local-marketing lever to a clear goal (drive breakfast trial, win back lapsed AM guests, or grow mobile breakfast orders). Be specific and practical — name the reward, the audience, and the steps. Keep it grounded in what one store can do in a week.${context ? `\n\nLocal context to consider: ${context}` : ''}

Return JSON of this exact shape:
{
  "ideas": [
    {
      "title": "short punchy name",
      "goal": "the one outcome this drives",
      "how": "2-3 concrete sentences the operator can act on this week",
      "reward": "the specific giveaway/lever used (or 'none' if marketing-only)",
      "audience": "who it targets",
      "effort": "low | medium",
      "metric": "what to watch to know it worked"
    }
  ]
}`;

  const data = await generateJSON(MODELS.synthesis, prompt, { thinkingBudget: 256 });
  const ideas = Array.isArray(data?.ideas) ? data.ideas.slice(0, count) : [];
  return { ideas, generatedAt: new Date().toISOString() };
}

module.exports = { generateBreakfastIdeas };
