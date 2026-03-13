/**
 * Tests for evalMathFn security — validates the whitelist approach
 * blocks code injection while allowing valid math expressions.
 * 
 * Run: node frontend/tests/test_eval_security.js
 */

const SAFE_MATH_RE = /^[0-9x+\-*/().,%^ \t]*$/;
const SAFE_FUNCS = [
  "Math.sin","Math.cos","Math.tan","Math.abs","Math.sqrt","Math.log","Math.log2","Math.log10",
  "Math.exp","Math.pow","Math.floor","Math.ceil","Math.round","Math.min","Math.max",
  "Math.PI","Math.E","Math.asin","Math.acos","Math.atan","Math.atan2",
  "Math.sinh","Math.cosh","Math.tanh","Math.sign","Math.cbrt","Math.hypot",
];

function evalMathFn(expr, x) {
  try {
    let stripped = expr;
    for (const fn of SAFE_FUNCS) stripped = stripped.replaceAll(fn, "");
    if (!SAFE_MATH_RE.test(stripped)) return NaN;
    const fn = new Function("x", "Math", `"use strict"; return (${expr});`);
    const result = fn(x, Math);
    return typeof result === "number" && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertNaN(val, msg) { assert(Number.isNaN(val), msg || `Expected NaN, got ${val}`); }

console.log("\n🔒 Security Tests — evalMathFn\n");

// === VALID EXPRESSIONS (should return numbers) ===
console.log("Valid math expressions:");
test("Simple polynomial: x*x + 2*x + 1", () => {
  assert(evalMathFn("x*x + 2*x + 1", 3) === 16);
});
test("Trig: Math.sin(x)", () => {
  assert(Math.abs(evalMathFn("Math.sin(x)", Math.PI/2) - 1) < 0.001);
});
test("Exponential: Math.exp(x)", () => {
  assert(Math.abs(evalMathFn("Math.exp(x)", 0) - 1) < 0.001);
});
test("Logarithm: Math.log(x)", () => {
  assert(Math.abs(evalMathFn("Math.log(x)", Math.E) - 1) < 0.001);
});
test("Power: Math.pow(x, 3)", () => {
  assert(evalMathFn("Math.pow(x, 3)", 2) === 8);
});
test("Sqrt: Math.sqrt(x)", () => {
  assert(evalMathFn("Math.sqrt(x)", 9) === 3);
});
test("Complex: Math.sin(x) * Math.cos(x) + 1", () => {
  const r = evalMathFn("Math.sin(x) * Math.cos(x) + 1", 0);
  assert(Math.abs(r - 1) < 0.001);
});
test("Constants: Math.PI * x", () => {
  assert(Math.abs(evalMathFn("Math.PI * x", 1) - Math.PI) < 0.001);
});
test("Nested: Math.abs(Math.sin(x))", () => {
  assert(evalMathFn("Math.abs(Math.sin(x))", -1) >= 0);
});

// === INJECTION ATTEMPTS (should all return NaN) ===
console.log("\nInjection attempts (must all return NaN):");
test("alert() injection", () => {
  assertNaN(evalMathFn('alert("xss")', 1));
});
test("window access", () => {
  assertNaN(evalMathFn("window.location.href", 1));
});
test("document access", () => {
  assertNaN(evalMathFn("document.cookie", 1));
});
test("require() injection", () => {
  assertNaN(evalMathFn('require("fs")', 1));
});
test("process.env access", () => {
  assertNaN(evalMathFn("process.env", 1));
});
test("constructor escape", () => {
  assertNaN(evalMathFn("this.constructor.constructor('return this')()", 1));
});
test("fetch() call", () => {
  assertNaN(evalMathFn('fetch("http://evil.com")', 1));
});
test("eval() injection", () => {
  assertNaN(evalMathFn('eval("1+1")', 1));
});
test("Function constructor", () => {
  assertNaN(evalMathFn('Function("return 1")()', 1));
});
test("Semicolon breakout", () => {
  assertNaN(evalMathFn("1; alert(1)", 1));
});
test("Template literal injection", () => {
  assertNaN(evalMathFn("`${alert(1)}`", 1));
});
test("Import expression", () => {
  assertNaN(evalMathFn('import("os")', 1));
});
test("globalThis access", () => {
  assertNaN(evalMathFn("globalThis.process", 1));
});
test("Prototype pollution", () => {
  assertNaN(evalMathFn("({}).__proto__", 1));
});
test("Symbol access", () => {
  assertNaN(evalMathFn("Symbol.for('test')", 1));
});

// === EDGE CASES ===
console.log("\nEdge cases:");
test("Empty expression", () => {
  assertNaN(evalMathFn("", 1));
});
test("Division by zero → Infinity → NaN", () => {
  assertNaN(evalMathFn("1/0", 1));
});
test("Negative sqrt → NaN", () => {
  assertNaN(evalMathFn("Math.sqrt(x)", -1));
});

console.log(`\n📊 Results: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
