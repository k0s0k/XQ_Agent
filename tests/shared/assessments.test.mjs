import assert from "node:assert/strict";
import test from "node:test";
import { ASSESSMENTS, scoreAssessment } from "../../src/shared/assessments.mjs";

function answersFor(total, length) {
  return Array.from({ length }, (_, index) => Math.max(0, Math.min(3, total - index * 3)));
}

test("catalog provides complete adult, two-week Chinese questionnaires with source attribution", () => {
  assert.deepEqual(
    ASSESSMENTS.map(({ id, questions }) => [id, questions.length]),
    [
      ["phq9", 9],
      ["gad7", 7],
    ],
  );
  assert.match(ASSESSMENTS[0].questions[7], /别人已经觉察/);
  assert.match(ASSESSMENTS[0].questions[7], /更胜于平常/);
  for (const assessment of ASSESSMENTS) {
    assert.match(assessment.instructions, /成年/);
    assert.match(assessment.instructions, /过去两周/);
    assert.match(assessment.instructions, /不能作为诊断/);
    assert.equal(new Set(assessment.questions).size, assessment.questions.length);
    assert.ok(assessment.questions.every((question) => /[\u4e00-\u9fff]/u.test(question)));
    assert.deepEqual(
      assessment.options.map(({ value }) => value),
      [0, 1, 2, 3],
    );
    assert.equal(new URL(assessment.source.url).protocol, "https:");
  }
});

test("PHQ-9 scoring covers every total and both edges of each clinical interval", () => {
  const bands = [
    [0, 4, "极轻或无明显症状"],
    [5, 9, "轻度"],
    [10, 14, "中度"],
    [15, 19, "中重度"],
    [20, 27, "重度"],
  ];
  for (const [low, high, severity] of bands) {
    for (let score = low; score <= high; score += 1) {
      const result = scoreAssessment("phq9", answersFor(score, 9));
      assert.equal(result.score, score);
      assert.equal(result.severity, severity, `PHQ-9 ${score}`);
      assert.match(result.interpretation, /不是诊断/);
      assert.match(result.interpretation, /不能排除安全风险/);
    }
  }
});

test("GAD-7 scoring covers every total, including 15 and maximum 21", () => {
  const bands = [
    [0, 4, "极轻或无明显症状"],
    [5, 9, "轻度"],
    [10, 14, "中度"],
    [15, 21, "重度"],
  ];
  for (const [low, high, severity] of bands) {
    for (let score = low; score <= high; score += 1) {
      const result = scoreAssessment("gad7", answersFor(score, 7));
      assert.equal(result.score, score);
      assert.equal(result.severity, severity, `GAD-7 ${score}`);
      assert.equal(result.requiresSafetyCheck, false);
      assert.match(result.interpretation, /不直接评估自伤或自杀风险/);
      assert.doesNotMatch(result.interpretation, /第 9 项/);
    }
  }
});

test("any nonzero PHQ-9 item 9 requires attention regardless of low total", () => {
  for (const answer of [1, 2, 3]) {
    const result = scoreAssessment("phq9", [...Array(8).fill(0), answer]);
    assert.equal(result.score, answer);
    assert.equal(result.requiresSafetyCheck, true);
    assert.match(result.interpretation, /及时直接核查/);
    assert.match(result.interpretation, /不代表存在即刻危险/);
  }
  const noItem9 = scoreAssessment("phq9", [...Array(8).fill(3), 0]);
  assert.equal(noItem9.score, 24);
  assert.equal(noItem9.requiresSafetyCheck, false);
  assert.match(noItem9.interpretation, /不能排除安全风险/);
});

test("validation refuses unknown instruments, missing items, coercion, fractions and sparse arrays", () => {
  for (const invalid of ["PHQ9", "", null, undefined, {}, "__proto__"]) {
    assert.throws(() => scoreAssessment(invalid, Array(9).fill(0)), TypeError);
  }
  for (const instrument of ["phq9", "gad7"]) {
    const length = instrument === "phq9" ? 9 : 7;
    for (const invalid of [
      null,
      undefined,
      {},
      "0".repeat(length),
      new Uint8Array(length),
      [],
      Array(length - 1).fill(0),
      Array(length + 1).fill(0),
      Array(length),
    ]) {
      assert.throws(() => scoreAssessment(instrument, invalid), TypeError);
    }
    for (const invalid of ["0", null, undefined, NaN, Infinity, -1, 4, 0.5, true, {}, 0n]) {
      const answers = Array(length).fill(0);
      answers[length - 1] = invalid;
      assert.throws(() => scoreAssessment(instrument, answers), TypeError);
    }
    const inheritedItem = Array(length).fill(0);
    delete inheritedItem[1];
    Object.setPrototypeOf(inheritedItem, Object.assign(Object.create(Array.prototype), { 1: 0 }));
    assert.throws(() => scoreAssessment(instrument, inheritedItem), TypeError);
  }
});

test("scoring preserves provided answers without sharing mutable input references", () => {
  const answers = Array(9).fill(1);
  const result = scoreAssessment("phq9", answers);
  assert.deepEqual(result.answers, answers);
  result.answers[0] = 3;
  assert.equal(answers[0], 1);
  answers[1] = 3;
  assert.equal(result.answers[1], 1);
  assert.equal(scoreAssessment("phq9", Object.freeze(Array(9).fill(0))).score, 0);
});

test("catalog cannot be mutated to silently change future scores or displayed options", () => {
  assert.throws(() => ASSESSMENTS[0].questions.push("extra"), TypeError);
  assert.throws(() => {
    ASSESSMENTS[0].options[0].value = 3;
  }, TypeError);
  assert.throws(() => {
    ASSESSMENTS[0].source.url = "invalid";
  }, TypeError);
});
