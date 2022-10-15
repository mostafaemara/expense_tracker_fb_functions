const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.addTransaction = functions.https.onCall(async (data, context) => {
  const accountId = data.accountId;
  data.created_at = admin.firestore.Timestamp.now().toDate().toISOString();
  data.userId = context.auth.uid;
  const account = await getAccount(accountId);
  if (data.type == "expense") {
    if (account.balance < data.amount) {
      throw new functions.https.HttpsError(
        "out-of-range",
        "Not enough Balance avalible balance: " + account.balance
      );
    }
    const transaction = await admin
      .firestore()
      .collection("transactions")
      .add(data);

    return JSON.stringify({
      account,
      ...data,
      id: transaction.id,
    });
  } else {
    const transaction = await admin
      .firestore()
      .collection("transactions")
      .add(data);

    return JSON.stringify({
      account: { ...account },
      ...data,
      id: transaction.id,
    });
  }
});

async function getAccount(accountId) {
  var expense = 0;
  var income = 0;
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

async function calculateTotalAccountTransactions(accountId) {
  var expense = 0;
  var income = 0;
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
  var expense = 0;
  var income = 0;
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
