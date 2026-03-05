type SeedClub = {
  pla: string;
  aliases: string[];
};

const SEEDED_CLUBS: SeedClub[] = [
  { pla: "ARS", aliases: ["arsenal"] },
  { pla: "AVL", aliases: ["aston villa"] },
  { pla: "BOU", aliases: ["bournemouth", "afc bournemouth"] },
  { pla: "BRE", aliases: ["brentford"] },
  {
    pla: "BHA",
    aliases: ["brighton", "brighton hove albion", "brighton and hove albion"],
  },
  { pla: "BUR", aliases: ["burnley"] },
  { pla: "CHE", aliases: ["chelsea"] },
  { pla: "CRY", aliases: ["crystal palace", "palace"] },
  { pla: "EVE", aliases: ["everton"] },
  { pla: "FUL", aliases: ["fulham"] },
  { pla: "IPS", aliases: ["ipswich", "ipswich town"] },
  { pla: "LEI", aliases: ["leicester", "leicester city"] },
  { pla: "LIV", aliases: ["liverpool"] },
  { pla: "MCI", aliases: ["manchester city", "man city"] },
  { pla: "MUN", aliases: ["manchester united", "man utd", "manchester utd"] },
  { pla: "NEW", aliases: ["newcastle", "newcastle united"] },
  { pla: "NFO", aliases: ["nottingham forest", "forest"] },
  { pla: "SOU", aliases: ["southampton"] },
  { pla: "TOT", aliases: ["tottenham", "tottenham hotspur", "spurs"] },
  { pla: "WHU", aliases: ["west ham", "west ham united"] },
  { pla: "WOL", aliases: ["wolves", "wolverhampton wanderers"] },
  { pla: "SUN", aliases: ["sunderland", "sunderland afc"] },
  { pla: "LEE", aliases: ["leeds", "leeds united"] },
  { pla: "BIR", aliases: ["birmingham", "birmingham city"] },
  { pla: "BLA", aliases: ["blackburn", "blackburn rovers"] },
  { pla: "BRC", aliases: ["bristol city"] },
  { pla: "COV", aliases: ["coventry", "coventry city"] },
  { pla: "DER", aliases: ["derby", "derby county"] },
  { pla: "MID", aliases: ["middlesbrough"] },
  { pla: "MIL", aliases: ["millwall"] },
  { pla: "NOR", aliases: ["norwich", "norwich city"] },
  { pla: "OXF", aliases: ["oxford", "oxford united"] },
  { pla: "PLY", aliases: ["plymouth", "plymouth argyle"] },
  { pla: "POR", aliases: ["portsmouth"] },
  { pla: "PRE", aliases: ["preston", "preston north end"] },
  { pla: "QPR", aliases: ["qpr", "queens park rangers"] },
  { pla: "SHU", aliases: ["sheffield united"] },
  { pla: "SHW", aliases: ["sheffield wednesday"] },
  { pla: "STK", aliases: ["stoke", "stoke city"] },
  { pla: "SWA", aliases: ["swansea", "swansea city"] },
  { pla: "WAT", aliases: ["watford"] },
  { pla: "WBA", aliases: ["west brom", "west bromwich albion"] },
  { pla: "RMA", aliases: ["real madrid"] },
  { pla: "BAR", aliases: ["barcelona", "fc barcelona"] },
  {
    pla: "ATM",
    aliases: ["atletico madrid", "atlético madrid", "atletico de madrid"],
  },
  { pla: "ATH", aliases: ["athletic club", "athletic bilbao"] },
  { pla: "BET", aliases: ["real betis", "betis"] },
  { pla: "SEV", aliases: ["sevilla"] },
  { pla: "VIL", aliases: ["villarreal"] },
  { pla: "SOC", aliases: ["real sociedad", "sociedad"] },
  { pla: "VAL", aliases: ["valencia"] },
  { pla: "GIR", aliases: ["girona"] },
  {
    pla: "BAY",
    aliases: ["bayern", "bayern munich", "bayern munchen", "fc bayern"],
  },
  { pla: "BVB", aliases: ["borussia dortmund", "dortmund"] },
  { pla: "RBL", aliases: ["rb leipzig", "red bull leipzig", "leipzig"] },
  { pla: "LEV", aliases: ["bayer leverkusen", "leverkusen"] },
  { pla: "STU", aliases: ["stuttgart", "vfb stuttgart"] },
  { pla: "SGE", aliases: ["eintracht frankfurt", "frankfurt"] },
  { pla: "SCF", aliases: ["freiburg", "sc freiburg"] },
  { pla: "WOB", aliases: ["wolfsburg", "vfl wolfsburg"] },
  { pla: "JUV", aliases: ["juventus"] },
  { pla: "INT", aliases: ["inter", "inter milan", "internazionale"] },
  { pla: "MIL", aliases: ["milan", "ac milan"] },
  { pla: "NAP", aliases: ["napoli"] },
  { pla: "ROM", aliases: ["roma", "as roma"] },
  { pla: "LAZ", aliases: ["lazio"] },
  { pla: "ATA", aliases: ["atalanta"] },
  { pla: "FIO", aliases: ["fiorentina"] },
  { pla: "BOL", aliases: ["bologna"] },
  { pla: "PAR", aliases: ["parma"] },
  {
    pla: "PSG",
    aliases: ["paris saint germain", "paris saint-germain", "psg"],
  },
  { pla: "OM", aliases: ["marseille", "olympique marseille"] },
  { pla: "OL", aliases: ["lyon", "olympique lyon"] },
  { pla: "ASM", aliases: ["monaco", "as monaco"] },
  { pla: "LIL", aliases: ["lille"] },
  { pla: "NIC", aliases: ["nice", "ogc nice"] },
  { pla: "REN", aliases: ["rennes", "stade rennais"] },
  { pla: "PSV", aliases: ["psv", "psv eindhoven"] },
  { pla: "FEY", aliases: ["feyenoord"] },
  { pla: "AJA", aliases: ["ajax"] },
  { pla: "AZA", aliases: ["az alkmaar", "alkmaar"] },
  { pla: "TWE", aliases: ["twente", "fc twente"] },
  { pla: "BEN", aliases: ["benfica", "sl benfica"] },
  { pla: "POR", aliases: ["porto", "fc porto"] },
  { pla: "SCP", aliases: ["sporting", "sporting cp", "sporting lisbon"] },
  { pla: "BRA", aliases: ["braga", "sc braga", "sporting braga"] },
  { pla: "CLB", aliases: ["club brugge", "club brugge kv"] },
  { pla: "AND", aliases: ["anderlecht", "rsc anderlecht"] },
  { pla: "GEN", aliases: ["gent", "kaa gent"] },
  {
    pla: "USG",
    aliases: ["union sg", "union saint gilloise", "union saint-gilloise"],
  },
  { pla: "CEL", aliases: ["celtic"] },
  { pla: "RAN", aliases: ["rangers"] },
  { pla: "SAL", aliases: ["salzburg", "rb salzburg", "red bull salzburg"] },
  { pla: "YBO", aliases: ["young boys", "bsc young boys"] },
  { pla: "DZG", aliases: ["dinamo zagreb", "gnk dinamo zagreb"] },
  { pla: "GAL", aliases: ["galatasaray"] },
  { pla: "FEN", aliases: ["fenerbahce", "fenerbahçe"] },
  { pla: "BJK", aliases: ["besiktas", "beşiktaş"] },
  { pla: "SHA", aliases: ["shakhtar", "shakhtar donetsk"] },
  { pla: "DKY", aliases: ["dynamo kyiv", "dynamo kiev", "dinamo kyiv"] },
  { pla: "SLP", aliases: ["slavia prague", "slavia praha"] },
  { pla: "SPP", aliases: ["sparta prague", "sparta praha"] },
  { pla: "COP", aliases: ["copenhagen", "fc copenhagen"] },
  { pla: "MID", aliases: ["midtjylland", "fc midtjylland"] },
  { pla: "MAL", aliases: ["malmo", "malmö"] },
  { pla: "OLY", aliases: ["olympiacos"] },
  { pla: "PAO", aliases: ["panathinaikos"] },
  { pla: "PAK", aliases: ["paok"] },
  { pla: "FER", aliases: ["ferencvaros", "ferencváros"] },
  { pla: "RSB", aliases: ["red star", "red star belgrade", "crvena zvezda"] },
  { pla: "PLZ", aliases: ["viktoria plzen", "viktoria plzeň"] },
  {
    pla: "BOD",
    aliases: ["bodo glimt", "bodo/glimt", "bodø glimt", "bodø/glimt"],
  },
  { pla: "MOL", aliases: ["molde"] },
  {
    pla: "ZRI",
    aliases: [
      "zrinjski",
      "zrinjski mostar",
      "hsk zrinjski",
      "hšk zrinjski mostar",
    ],
  },
  { pla: "LUD", aliases: ["ludogorets", "ludogorets razgrad"] },
  { pla: "HAC", aliases: ["le havre", "le havre ac"] },
];

const FILLER_TOKENS = new Set([
  "fc",
  "afc",
  "cf",
  "sc",
  "ac",
  "club",
  "city",
  "united",
  "town",
  "athletic",
  "de",
  "of",
  "the",
]);

export function normalizeClubKey(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CLUB_PLA_BY_ALIAS = new Map<string, string>();
for (const club of SEEDED_CLUBS) {
  for (const alias of club.aliases) {
    CLUB_PLA_BY_ALIAS.set(normalizeClubKey(alias), club.pla);
  }
}

export function resolveSeededClubPla(
  name?: string | null,
  shortName?: string | null,
) {
  const fromName = CLUB_PLA_BY_ALIAS.get(normalizeClubKey(name));
  if (fromName) return fromName;
  const fromShortName = CLUB_PLA_BY_ALIAS.get(normalizeClubKey(shortName));
  if (fromShortName) return fromShortName;
  return null;
}

export function deriveFallbackClubPla(
  name?: string | null,
  shortName?: string | null,
) {
  const source = String(shortName || name || "")
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .trim();
  const tokens = source
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const filtered = tokens.filter(
    (token) => !FILLER_TOKENS.has(token.toLowerCase()),
  );
  const base = filtered[0] || tokens[0] || "FC";
  const alnum = base.replace(/[^A-Za-z0-9]/g, "");
  return (alnum || "FC").slice(0, 3).toUpperCase();
}
