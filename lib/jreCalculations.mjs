function finiteNumber(name, value, { min = 0, required = true } = {}) {
  if ((value === undefined || value === null || value === "") && !required) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number.`);
  if (number < min) throw new Error(`${name} must be >= ${min}.`);
  return number;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundPercent(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function annualizeAmount(amount, period = "annual") {
  const value = finiteNumber("amount", amount, { min:0 });
  const normalizedPeriod = `${period || "annual"}`.trim();
  if (normalizedPeriod === "monthly") return value * 12;
  if (normalizedPeriod === "annual" || normalizedPeriod === "yearly") return value;
  if (normalizedPeriod === "quarterly") return value * 4;
  if (normalizedPeriod === "one_time") return value;
  throw new Error("period must be one of: monthly, quarterly, annual, yearly, one_time");
}

function sumAnnualAmounts(records = [], { amountField = "amount", periodField = "period" } = {}) {
  return roundMoney(records.reduce((sum, record) => {
    if (record?.review_status === "archived") return sum;
    const amount = record?.[amountField];
    if (amount === undefined || amount === null || amount === "") return sum;
    return sum + annualizeAmount(amount, record?.[periodField] || "annual");
  }, 0));
}

function calculateGrossYield({ annualRent, acquisitionPrice }) {
  const rent = finiteNumber("annualRent", annualRent, { min:0 });
  const price = finiteNumber("acquisitionPrice", acquisitionPrice, { min:1 });
  return roundPercent((rent / price) * 100);
}

function calculateNetOperatingIncome({ annualEffectiveRent, annualOperatingExpenses = 0, annualTaxes = 0 }) {
  const rent = finiteNumber("annualEffectiveRent", annualEffectiveRent, { min:0 });
  const expenses = finiteNumber("annualOperatingExpenses", annualOperatingExpenses, { min:0 });
  const taxes = finiteNumber("annualTaxes", annualTaxes, { min:0 });
  return roundMoney(rent - expenses - taxes);
}

function calculateNetYield({ noi, acquisitionPrice }) {
  const netIncome = finiteNumber("noi", noi, { min:-Number.MAX_SAFE_INTEGER });
  const price = finiteNumber("acquisitionPrice", acquisitionPrice, { min:1 });
  return roundPercent((netIncome / price) * 100);
}

function calculateMonthlyLoanPayment({ principal, annualInterestRatePercent, termMonths }) {
  const principalAmount = finiteNumber("principal", principal, { min:0 });
  const annualRate = finiteNumber("annualInterestRatePercent", annualInterestRatePercent, { min:0 }) / 100;
  const months = finiteNumber("termMonths", termMonths, { min:1 });
  if (!Number.isInteger(months)) throw new Error("termMonths must be an integer.");
  if (principalAmount === 0) return 0;
  if (annualRate === 0) return roundMoney(principalAmount / months);
  const monthlyRate = annualRate / 12;
  const payment = principalAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  return roundMoney(payment);
}

function calculateDebtServiceCoverageRatio({ noi, annualDebtService }) {
  const netIncome = finiteNumber("noi", noi, { min:-Number.MAX_SAFE_INTEGER });
  const debtService = finiteNumber("annualDebtService", annualDebtService, { min:0 });
  if (debtService === 0) return null;
  return Math.round((netIncome / debtService) * 1000) / 1000;
}

function collectIds(records = [], field) {
  return [...new Set(records.map(record => record?.[field]).filter(Boolean))];
}

function buildInvestmentMetrics({ propertyId, acquisitionPrice, leases = [], expenses = [], taxes = [], loans = [], vacancyRatePercent = 0 } = {}) {
  const price = finiteNumber("acquisitionPrice", acquisitionPrice, { min:1 });
  const vacancy = finiteNumber("vacancyRatePercent", vacancyRatePercent, { min:0 });
  if (vacancy > 100) throw new Error("vacancyRatePercent must be <= 100.");

  const annualPotentialRent = sumAnnualAmounts(leases, { amountField:"rent_amount", periodField:"period" });
  const annualEffectiveRent = roundMoney(annualPotentialRent * (1 - vacancy / 100));
  const annualOperatingExpenses = sumAnnualAmounts(expenses, { amountField:"amount", periodField:"period" });
  const annualTaxes = sumAnnualAmounts(taxes, { amountField:"amount", periodField:"period" });
  const noi = calculateNetOperatingIncome({ annualEffectiveRent, annualOperatingExpenses, annualTaxes });
  const grossYieldPercent = calculateGrossYield({ annualRent:annualPotentialRent, acquisitionPrice:price });
  const netYieldPercent = calculateNetYield({ noi, acquisitionPrice:price });
  const annualDebtService = roundMoney(loans.reduce((sum, loan) => {
    if (loan?.review_status === "archived") return sum;
    const principal = loan?.principal_amount ?? loan?.principal;
    if (principal === undefined || principal === null || principal === "") return sum;
    const monthlyPayment = calculateMonthlyLoanPayment({
      principal,
      annualInterestRatePercent:loan?.interest_rate ?? loan?.annual_interest_rate_percent ?? 0,
      termMonths:loan?.term_months,
    });
    return sum + monthlyPayment * 12;
  }, 0));
  const cashFlowBeforeTax = roundMoney(noi - annualDebtService);
  const debtServiceCoverageRatio = calculateDebtServiceCoverageRatio({ noi, annualDebtService });
  const sourceIds = collectIds([...leases, ...expenses, ...taxes, ...loans], "source_id");
  const evidenceRefIds = [...new Set([...leases, ...expenses, ...taxes, ...loans].flatMap(record => Array.isArray(record?.evidence_ref_ids) ? record.evidence_ref_ids : []))];

  return {
    propertyId:`${propertyId || ""}`.trim(),
    calculation_method:"deterministic_code",
    inputs:{
      acquisitionPrice:price,
      vacancyRatePercent:vacancy,
      leaseRecords:leases.length,
      expenseRecords:expenses.length,
      taxRecords:taxes.length,
      loanRecords:loans.length,
    },
    formulas:{
      annualPotentialRent:"sum(monthly rent * 12 or annual rent)",
      annualEffectiveRent:"annualPotentialRent * (1 - vacancyRatePercent / 100)",
      noi:"annualEffectiveRent - annualOperatingExpenses - annualTaxes",
      grossYieldPercent:"annualPotentialRent / acquisitionPrice * 100",
      netYieldPercent:"noi / acquisitionPrice * 100",
      monthlyLoanPayment:"P*r/(1-(1+r)^-n), r = annualInterestRate/12",
      dscr:"noi / annualDebtService",
    },
    outputs:{
      annualPotentialRent,
      annualEffectiveRent,
      annualOperatingExpenses,
      annualTaxes,
      noi,
      grossYieldPercent,
      netYieldPercent,
      annualDebtService,
      cashFlowBeforeTax,
      debtServiceCoverageRatio,
    },
    audit:{
      sourceIds,
      evidenceRefIds,
      calculatedAt:new Date().toISOString(),
      note:"Deterministic code calculation. LLM must not alter numeric outputs.",
    },
  };
}

export {
  annualizeAmount,
  buildInvestmentMetrics,
  calculateDebtServiceCoverageRatio,
  calculateGrossYield,
  calculateMonthlyLoanPayment,
  calculateNetOperatingIncome,
  calculateNetYield,
  sumAnnualAmounts,
};
