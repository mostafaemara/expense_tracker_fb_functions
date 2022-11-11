const admin = require("firebase-admin");
const { groupBy } = require("lodash");

function groupTransactionsByDate(transactions) {
  const copyOfTransactions = transactions;

  copyOfTransactions.forEach((t) => t.created_at.setHours(0, 0, 0, 0));

  const transactionsGroupedByDate = groupBy(copyOfTransactions, (transaction) =>
    transaction.created_at.toISOString()
  );
  return Object.keys(transactionsGroupedByDate).map((key) => {
    return {
      date: key,
      transactions: transactionsGroupedByDate[key],
    };
  });
}
async function populateTransactions(transactions) {
  var populatedtransactions = [];
  for (var doc of transactions) {
    var transaction = doc.data();
    transaction.created_at = transaction.created_at.toDate();
    transaction.id = doc.id;
    const accountSnap = await admin
      .firestore()
      .collection("accounts")
      .doc(transaction.accountId)
      .get();
    const categorySnap = await admin
      .firestore()
      .collection("utils")
      .doc("expense")
      .collection("categories")
      .doc(transaction.categoryId)
      .get();

    transaction.category = categorySnap.data();
    transaction.category.id = categorySnap.id;
    transaction.account = accountSnap.data();
    transaction.account.id = accountSnap.id;

    populatedtransactions.push(transaction);
  }
  return populatedtransactions;
}

async function getAccount(accountId) {
  var expense = 0.0;
  var income = 0.0;
  const accountSnap = await admin
    .firestore()
    .collection("accounts")
    .doc(accountId)
    .get();
  var account = accountSnap.data();
  account.id = accountSnap.id;
  var totalTransactions = await calculateTotalAccountTransactions(accountId);
  expense += totalTransactions.expense;
  income += totalTransactions.income;
  var totalTransfers = await calculateTotalAccountTransfers(accountId);
  expense += totalTransfers.expense;
  income += totalTransfers.income;

  account.balance += income - expense;

  return account;
}
async function getUserAccounts(userId) {
  const accountsSnap = await admin
    .firestore()
    .collection("accounts")
    .where("userId", "==", userId)
    .get();
  var accounts = [];

  for (var doc of accountsSnap.docs) {
    var expense = 0.0;
    var income = 0.0;
    var account = doc.data();
    account.id = doc.id;

    var totalTransactions = await calculateTotalAccountTransactions(account.id);
    expense += totalTransactions.expense;
    income += totalTransactions.income;
    var totalTransfers = await calculateTotalAccountTransfers(account.id);
    expense += totalTransfers.expense;
    income += totalTransfers.income;

    account.balance += income - expense;
    account.expense = expense;
    account.income = income;
    accounts.push(account);
  }

  return accounts;
}

async function calculateTotalAccountTransactions(accountId) {
  var expense = 0.0;
  var income = 0.0;
  const transactions = await admin
    .firestore()
    .collection("transactions")
    .where("accountId", "==", accountId)
    .get();

  for (var doc of transactions.docs) {
    if (doc.data().type == "expense") {
      expense += doc.data().amount;
    } else if (doc.data().type == "income") {
      income += doc.data().amount;
    }
  }
  return {
    expense,
    income,
  };
}
async function calculateTotalAccountTransfers(accountId) {
  var expense = 0.0;
  var income = 0.0;
  const outcomeTransfers = await admin
    .firestore()
    .collection("transfer")
    .where("fromAccountId", "==", accountId)
    .get();
  const incomeTransfers = await admin
    .firestore()
    .collection("transfer")
    .where("toAccountId", "==", accountId)
    .get();

  for (var doc of outcomeTransfers.docs) {
    expense += doc.data().amount;
  }
  for (var doc of incomeTransfers.docs) {
    income += doc.data().amount;
  }

  return {
    expense,
    income,
  };
}
async function calculateExpensesOfCategory(userId, categoryId, month) {
  var expense = 0.0;
  const today = new Date();

  console.log("month" + month);
  month = Number.parseInt(month);
  console.log("month" + month);
  var from = new Date(today.getFullYear(), month, 1);
  var to = new Date(today.getFullYear(), month + 1, 1);

  console.log("today" + today);
  console.log("from" + from);
  console.log("to" + to);
  const transactionsSnap = await admin
    .firestore()
    .collection("transactions")
    .where("userId", "==", userId)
    .where("categoryId", "==", categoryId)
    .where("created_at", ">=", from)
    .where("created_at", "<=", to)
    .where("type", "==", "expense")
    .select("amount")
    .get();
  for (var doc of transactionsSnap.docs) {
    expense += doc.data().amount;
  }

  return expense;
}

async function totalTransactionsInDate(userId, date, type) {
  var transactionAmount = 0;

  const transactionsSnap = await admin
    .firestore()
    .collection("transactions")
    .where("userId", "==", userId)

    .where("created_at", ">=", new Date(date.getFullYear(), date.getMonth(), 1))
    .where(
      "created_at",
      "<=",
      new Date(date.getFullYear(), date.getMonth() + 1, 1)
    )
    .where("type", "==", type)

    .get();

  const transactions = await populateTransactions(transactionsSnap.docs);

  for (const t of transactions) {
    transactionAmount += t.amount;
  }

  const indexOfMaxValue = transactions.reduce(
    (iMax, x, i, arr) => (x.amount > arr[iMax].amount ? i : iMax),
    0
  );
  const highestTransaction = transactions[indexOfMaxValue];

  return {
    amount: transactionAmount,
    transactions,
    highestTransaction: highestTransaction,
  };
}

async function calculateBudgets(expenses, userId, month) {
  var exceededBudgets = [];
  var budgets = [];
  const budgetsDoc = await admin
    .firestore()
    .collection("budgets")
    .where("userId", "==", userId)
    .get();
  var budgets = [];
  for (var doc of budgetsDoc.docs) {
    var budget = doc.data();
    budget.id = doc.id;
    const categoryDoc = await admin
      .firestore()
      .collection("utils")
      .doc("expense")
      .collection("categories")
      .doc(budget.categoryId)
      .get();
    budget.amountSpent = 0;

    budget.category = categoryDoc.data();
    budget.category.id = categoryDoc.id;

    budgets.push(budget);
  }
  for (const b of budgets) {
    const budgetExpenses = expenses.filter((e) => {
      return e.categoryId == b.categoryId;
    });

    const amount = calculateTotalAmountOfTransactions(budgetExpenses);

    if (amount >= b.amount) {
      exceededBudgets.push(b);
    }
  }

  return {
    budgets,
    exceededBudgets,
  };
}

function calculateTotalAmountOfTransactions(expenses) {
  var amount = 0;

  for (const t of expenses) {
    amount += t.amount;
  }
  return amount;
}

var DateDiff = {
  inDays: function (d1, d2) {
    var t2 = d2.getTime();
    var t1 = d1.getTime();

    return Math.floor((t2 - t1) / (24 * 3600 * 1000));
  },

  inWeeks: function (d1, d2) {
    var t2 = d2.getTime();
    var t1 = d1.getTime();

    return parseInt((t2 - t1) / (24 * 3600 * 1000 * 7));
  },

  inMonths: function (d1, d2) {
    var d1Y = d1.getFullYear();
    var d2Y = d2.getFullYear();
    var d1M = d1.getMonth();
    var d2M = d2.getMonth();

    return d2M + 12 * d2Y - (d1M + 12 * d1Y);
  },

  inYears: function (d1, d2) {
    return d2.getFullYear() - d1.getFullYear();
  },
};
module.exports = {
  calculateBudgets,
  totalTransactionsInDate,
  calculateExpensesOfCategory,
  calculateTotalAccountTransactions,
  getAccount,
  getUserAccounts,
  groupTransactionsByDate,
  populateTransactions,
  DateDiff,
};
