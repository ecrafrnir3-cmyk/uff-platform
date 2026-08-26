// Unit test for feat detection (Phase 2b). Run: npx tsx scripts/story-feats-test.ts
import { detectStatFeats, calcScore } from "../src/lib/story-engine/feats";

let pass = 0,
  fail = 0;
const ck = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error("FAIL:", n)));
const feats = (lines: Record<string, number>[], settings: Record<string, number> = {}) =>
  detectStatFeats(lines, settings)
    .map((f) => f.feat)
    .sort();

ck("no feats on a clean line", feats([{ rush_yd: 40, rec_yd: 20 }]).length === 0);
ck("3 pass TD → explosion", feats([{ pass_td: 3 }]).includes("explosion"));
ck("30-pt player → explosion", feats([{ pass_yd: 400, pass_td: 4 }], { pass_yd: 0.04, pass_td: 4 }).includes("explosion"));
ck("3 sacks → stonewall", feats([{ sack: 3 }]).includes("stonewall"));
ck("def TD → stonewall + twist", (() => {
  const f = feats([{ def_td: 1 }]);
  return f.includes("stonewall") && f.includes("twist_of_fate");
})());
ck("150 scrimmage yds → breakaway", feats([{ rush_yd: 90, rec_yd: 70 }]).includes("breakaway"));
ck("forced fumble → twist", feats([{ ff: 1 }]).includes("twist_of_fate"));
ck("calcScore honors settings", calcScore({ pass_yd: 300, pass_td: 2 }, { pass_yd: 0.04, pass_td: 4 }) === 20);
ck("one of each feat max (dedup)", feats([{ pass_td: 3 }, { pass_td: 4 }]).length === 1);
ck("multiple distinct feats", feats([{ pass_td: 3 }, { rush_yd: 160 }, { sack: 4 }]).length === 3);

console.log(`Feat tests: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
