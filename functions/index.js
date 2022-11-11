const functions = require("firebase-functions");
const admin = require("firebase-admin");

const {
  groupTransactionsByDate,
  calculateExpensesOfCategory,

  getAccount,
  getUserAccounts,
  populateTransactions,
  calculateTotalAccountTransactions,
  DateDiff,
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

  if (data.frequency) {
    data.updated_at = admin.firestore.Timestamp.now();
    await admin.firestore().collection("transactionFrequencies").add(data);
  }
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

exports.addTransfer = functions.https.onCall(async (data, context) => {
  const userId = context.auth.uid;
  const fromAccountId = data.fromAccountId;
  const toAccountId = data.toAccountId;
  const amount = data.amount;

  const fromAccount = await getAccount(fromAccountId);

  if (fromAccount.balance < amount) {
    throw new functions.https.HttpsError(
      "out-of-range",
      "Not enough Balance avalible balance: " + fromAccount.balance
    );
  }

  const transfer = await admin
    .firestore()
    .collection("transfer")
    .add({ ...data });
  return JSON.stringify({
    messege: "tranferAdded Succesfuly",
  });
});

exports.deleteTransaction = functions.https.onCall(async (data, context) => {
  const id = data.id;

  const transactionDoc = await admin
    .firestore()
    .collection("transactions")
    .doc(id)
    .get();

  if (transactionDoc.data().type == "income") {
    const account = await getAccount(transactionDoc.data().accountId);

    if (transactionDoc.data().amount > account.balance) {
      throw new functions.https.HttpsError(
        "out-of-range",
        "Cannot Delete Transaction incorrect balance"
      );
    }
    await admin.firestore().collection("transactions").doc(id).delete();
  } else {
    await admin.firestore().collection("transactions").doc(id).delete();
  }

  return JSON.stringify({
    messege: "Deleted Succesfuly",
  });
});

exports.frequencyTransactions = functions.pubsub
  .schedule("every 12 hours")
  .onRun(async (context) => {
    var frequenciesSnapShot = await admin
      .firestore()
      .collection("transactionFrequencies")
      .get();

    for (const doc of frequenciesSnapShot.docs) {
      const frequency = doc.data();

      const now = admin.firestore.Timestamp.now().toDate();
      const lastAddedDate = frequency.updated_at.toDate();
      switch (frequency.frequency) {
        case "daily":
          if (DateDiff.inDays(lastAddedDate, now) >= 1) {
            await addTransactionWithNotify(frequency, doc.id);
          }
          break;
        case "weekly":
          if (DateDiff.inWeeks(lastAddedDate, now) >= 1) {
            await addTransactionWithNotify(frequency, doc.id);
          }
          break;
        case "monthly":
          if (DateDiff.inMonths(lastAddedDate, now) >= 1) {
            await addTransactionWithNotify(frequency, doc.id);
          }
          break;
        case "yearly":
          if (DateDiff.inYears(lastAddedDate, now) >= 1) {
            await addTransactionWithNotify(frequency, doc.id);
          }
          break;
        default:
          break;
      }
    }
  });

async function addTransactionWithNotify(frequency, id) {
  const accountId = frequency.accountId;
  frequency.created_at = admin.firestore.Timestamp.now();

  const account = await getAccount(accountId);
  var userDoc = await admin
    .firestore()
    .collection("users")
    .doc(frequency.userId)
    .get();
  const token = userDoc.data().token;
  if (frequency.type == "expense" && account.balance < frequency.amount) {
    await sendNotification(
      "Coudnt add Transaction",
      "Not enough Balance avalible balance: " + account.balance,
      token,
      null
    );
    throw new functions.https.HttpsError(
      "out-of-range",
      "Not enough Balance avalible balance: " + account.balance
    );
  }
  const transaction = await admin
    .firestore()
    .collection("transactions")
    .add(frequency);
  await admin.firestore().collection("transactionFrequencies").doc(id).update({
    updated_at: admin.firestore.Timestamp.now(),
  });
  await sendNotification(
    "Transaction " + frequency.title + " Added",
    "Transaction " + frequency.title + " Added Amount: " + frequency.amount,
    token,
    ""
  );
}

async function sendNotification(title, body, token, data) {
  const payload = {
    token: token,
    notification: {
      title: title,
      body: body,
    },
    data: {
      body: body,
    },
  };

  await admin.messaging().send(payload);
}
