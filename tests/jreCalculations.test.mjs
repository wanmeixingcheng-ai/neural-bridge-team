import test from "node:test";
import assert from "node:assert/strict";

import {
  annualizeAmount,
  buildInvestmentMetrics,
  calculateDebtServiceCoverageRatio,
  calculateGrossYield,
  calculateMonthlyLoanPayment,
  calculateNetOperatingIncome,
  calculateNetYield,
  sumAnnualAmounts,
} from "../lib/jreCalculations.mjs";

test("annual amount helpers normalize periods without LLM math", () => {
  assert.equal(annualizeAmount(100000, "monthly"), 1200000);
  assert.equal(annualizeAmount(300000, "quarterly"), 1200000);
  assert.equal(annualizeAmount(1200000, "annual"), 1200000);
  assert.equal(sumAnnualAmounts([
    { amount:10000, period:"monthly" },
    { amount:24000, period:"annual" },
    { amount:999999, period:"annual", review_status:"archived" },
  ]), 144000);
});

test("yield and NOI calculations are deterministic and rounded", () => {
  const noi = calculateNetOperatingIncome({
    annualEffectiveRent:3000000,
    annualOperatingExpenses:420000,
    annualTaxes:180000,
  });

  assert.equal(noi, 2400000);
  assert.equal(calculateGrossYield({ annualRent:3600000, acquisitionPrice:60000000 }), 6);
  assert.equal(calculateNetYield({ noi, acquisitionPrice:60000000 }), 4);
});

test("loan amortization and DSCR use deterministic formulas", () => {
  assert.equal(calculateMonthlyLoanPayment({ principal:12000000, annualInterestRatePercent:0, termMonths:120 }), 100000);
  assert.equal(calculateMonthlyLoanPayment({ principal:30000000, annualInterestRatePercent:1.2, termMonths:360 }), 99272.61);
  assert.equal(calculateDebtServiceCoverageRatio({ noi:1800000, annualDebtService:1200000 }), 1.5);
  assert.equal(calculateDebtServiceCoverageRatio({ noi:1800000, annualDebtService:0 }), null);
});

test("investment metrics preserve formulas, sources, evidence, and deterministic boundary", () => {
  const metrics = buildInvestmentMetrics({
    propertyId:"prop-1",
    acquisitionPrice:60000000,
    vacancyRatePercent:5,
    leases:[
      { id:"lease-1", source_id:"src-lease", rent_amount:150000, period:"monthly", evidence_ref_ids:["ev-lease"] },
      { id:"lease-2", source_id:"src-lease", rent_amount:1200000, period:"annual", evidence_ref_ids:["ev-lease-2"] },
    ],
    expenses:[
      { id:"expense-1", source_id:"src-expense", amount:20000, period:"monthly", evidence_ref_ids:["ev-expense"] },
    ],
    taxes:[
      { id:"tax-1", source_id:"src-tax", amount:180000, period:"annual", evidence_ref_ids:["ev-tax"] },
    ],
    loans:[
      { id:"loan-1", source_id:"src-loan", principal_amount:30000000, interest_rate:1.2, term_months:360, evidence_ref_ids:["ev-loan"] },
    ],
  });

  assert.equal(metrics.calculation_method, "deterministic_code");
  assert.equal(metrics.outputs.annualPotentialRent, 3000000);
  assert.equal(metrics.outputs.annualEffectiveRent, 2850000);
  assert.equal(metrics.outputs.annualOperatingExpenses, 240000);
  assert.equal(metrics.outputs.annualTaxes, 180000);
  assert.equal(metrics.outputs.noi, 2430000);
  assert.equal(metrics.outputs.grossYieldPercent, 5);
  assert.equal(metrics.outputs.netYieldPercent, 4.05);
  assert.equal(metrics.outputs.annualDebtService, 1191271.32);
  assert.equal(metrics.outputs.cashFlowBeforeTax, 1238728.68);
  assert.equal(metrics.outputs.debtServiceCoverageRatio, 2.04);
  assert.deepEqual(metrics.audit.sourceIds, ["src-lease", "src-expense", "src-tax", "src-loan"]);
  assert.deepEqual(metrics.audit.evidenceRefIds, ["ev-lease", "ev-lease-2", "ev-expense", "ev-tax", "ev-loan"]);
  assert.match(metrics.audit.note, /LLM must not alter numeric outputs/);
});

test("investment metrics reject invalid numeric assumptions", () => {
  assert.throws(() => calculateGrossYield({ annualRent:100, acquisitionPrice:0 }), /acquisitionPrice/);
  assert.throws(() => buildInvestmentMetrics({ acquisitionPrice:1, vacancyRatePercent:120 }), /vacancyRatePercent/);
  assert.throws(() => calculateMonthlyLoanPayment({ principal:1000, annualInterestRatePercent:1, termMonths:12.5 }), /termMonths/);
});
