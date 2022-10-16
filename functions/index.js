const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.addTransaction = functions.https.onCall(async (data, context) => {
  const accountId = data.accountId;
  data.created_at = admin.firestore.Timestamp.now();
  data.userId = context.auth.uid;
  const account = await getAccount(accountId);
  if (data.type == "expense" && account.balance < data.amount) {
    throw new functions.https.HttpsError(
      "out-of-range",
      "Not enough Balance avalible balance: " + account.balance
    );
  }
  const transaction = await admin
    .firestore()
    .collection("transactions")
    .add(data);
  const categoryDoc = await admin
    .firestore()
    .collection("utils")
    .doc("expense")
    .collection("categories")
    .doc(data.categoryId)
    .get();

  const category = categoryDoc.data();
  category.id = categoryDoc.id;
  return JSON.stringify({
    account,
    category,
    ...data,
    id: transaction.id,
  });
});

exports.getAccounts = functions.https.onCall(async (data, context) => {
  userId = context.auth.uid;

  const accounts = await getUserAccounts(userId);

  return JSON.stringify(accounts);
});
exports.getFinance = functions.https.onCall(async (data, context) => {
  userId = context.auth.uid;
  var expenses = 0.0;
  var incomes = 0.0;
  var balance = 0.0;
  const accounts = await getUserAccounts(userId);
  for (var account of accounts) {
    expenses += account.expense;
    incomes += account.income;
    balance += account.balance;
  }
  return JSON.stringify({
    expenses,
    incomes,
    balance,
  });
});

exports.getTransactions = functions.https.onCall(async (data, context) => {
  userId = context.auth.uid;
  console.log("dataaaaaa" + data.toString());
  const sortBy = data["sortBy"];
  const limit = data["limit"];
  const from = data["from"];
  const to = data["to"];
  const type = data["type"];

  var snap = await admin
    .firestore()
    .collection("transactions")
    .where("userId", "==", userId)
    .get();

  if (type != null) {
    console.log("typeeeeeee" + type);
    snap.query.where("type", "==", type);
  }
  if (from != null && to != null) {
    const fromTimeStamp = new Date(from);
    const toTimeStamp = new Date(to);
    snap.query
      .where("created_at", ">=", fromTimeStamp)
      .where("created_at", "<=", toTimeStamp);
  }
  if (sortBy == "newest" || sortBy == "oldest") {
    snap.query.orderBy("created_at", sortBy == "newest" ? "desc" : "asc");
  }
  if (sortBy == "highest" || sortBy == "lowest") {
    snap.query.orderBy("amount", sortBy == "highest" ? "desc" : "asc");
  }
  if (limit != null) {
    snap.query.limit(limit);
  }
  const snapShots = await snap.query.get();
  const transactions = await populateTransactions(snapShots.docs);
  return JSON.stringify(transactions);
});

async function populateTransactions(transactions) {
  var populatedtransactions = [];
  for (var doc of transactions) {
    var transaction = doc.data();
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
