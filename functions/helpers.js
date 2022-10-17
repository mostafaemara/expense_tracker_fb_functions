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

module.exports = {
  calculateTotalAccountTransactions,
  getAccount,
  getUserAccounts,
  groupTransactionsByDate,
  populateTransactions,
};
