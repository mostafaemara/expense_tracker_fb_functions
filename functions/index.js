const functions = require("firebase-functions");
const admin = require("firebase-admin");

const {
  groupTransactionsByDate,
  calculateExpensesOfCategory,

  getAccount,
  getUserAccounts,
  populateTransactions,
  calculateTotalAccountTransactions,
  calculateBudgets,
  totalTransactionsInDate,
} = require("./helpers");
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
  data.created_at = data.created_at.toDate();
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
  const groupByDate = data["groupByDate"];
  const categories = data.categories;
  const accountId = data.accountId;

  var query = admin
    .firestore()
    .collection("transactions")
    .where("userId", "==", userId);
  if (type != null) {
    query = query.where("type", "==", type);
  }
  if (from != null && to != null) {
    const fromTimeStamp = new Date(from);
    const toTimeStamp = new Date(to);
    query = query
      .where("created_at", ">=", fromTimeStamp)
      .where("created_at", "<=", toTimeStamp);
  }
  if (accountId) {
    query = query.where("accountId", "==", accountId);
  }
  if (categories) {
    query = query.where("categoryId", "in", categories);
  }
  if (sortBy == "newest" || sortBy == "oldest") {
    query = query.orderBy("created_at", sortBy == "newest" ? "desc" : "asc");
  }
  if (sortBy == "highest" || sortBy == "lowest") {
    query = query.orderBy("amount", sortBy == "highest" ? "desc" : "asc");
  }
  if (limit != null) {
    query = query.limit(limit);
  }

  const snapShots = await query.get();
  const transactions = await populateTransactions(snapShots.docs);
  if (groupByDate) {
    const transactionsOfDate = groupTransactionsByDate(transactions);
    return JSON.stringify(transactionsOfDate);
  } else {
    return JSON.stringify(transactions);
  }
});

exports.addBudget = functions.https.onCall(async (data, context) => {
  userId = context.auth.uid;
  const categoryId = data.categoryId;
  data.userId = userId;

  const budgetsDoc = await admin
    .firestore()
    .collection("budgets")
    .where("userId", "==", userId)
    .where("categoryId", "==", categoryId)

    .get();

  const categoryDoc = await admin
    .firestore()
    .collection("utils")
    .doc("expense")
    .collection("categories")
    .doc(data.categoryId)
    .get();
  data.category = categoryDoc.data();
  data.category.id = categoryDoc.id;

  if (!budgetsDoc.empty) {
    throw new functions.https.HttpsError(
      "out-of-range",
      "Budget of this Category already exist"
    );
  }

  const budgetDoc = await admin.firestore().collection("budgets").add(data);
  data.id = budgetDoc.id;
  return JSON.stringify(data);
});

exports.getBudgets = functions.https.onCall(async (data, context) => {
  const userId = context.auth.uid;
  const month = data.month;
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
    budget.amountSpent = await calculateExpensesOfCategory(
      userId,
      budget.categoryId,
      month
    );

    budget.category = categoryDoc.data();
    budget.category.id = categoryDoc.id;

    budgets.push(budget);
  }
  return JSON.stringify(budgets);
});

exports.getFinancialReport = functions.https.onCall(async (data, context) => {
  const userId = context.auth.uid;
  var date = new Date(data.date);

  date.setHours(0, 0, 0, 0);

  const expenses = await totalTransactionsInDate(userId, date, "expense");
  const incomes = await totalTransactionsInDate(userId, date, "income");
  const budgetReport = await calculateBudgets(
    expenses.transactions,
    userId,
    date.getMonth()
  );

  return JSON.stringify({
    expenses: expenses.transactions,
    highestExpense: expenses.highestTransaction,
    expensesAmount: expenses.amount,
    incomes: incomes.transactions,
    highestIncome: incomes.highestTransaction,
    incomesAmount: incomes.amount,
    ...budgetReport,
  });
});
