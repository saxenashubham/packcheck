// Copy this file to config.js and fill in your values, then commit config.js.
// (These Firebase web keys are not secrets — access is controlled by ALLOWED_EMAILS
//  and your Firestore security rules, not by hiding this config.)
window.PACKCHECK = {
  // Firebase console -> Project settings -> your web app -> "SDK setup and configuration"
  firebase: {
    apiKey: "AIzaSyAve08JHxeRAAAv6CXwA26jno0jbyf1U_o",
    authDomain: "packcheck-b542a.firebaseapp.com",
    projectId: "packcheck-b542a",
    storageBucket: "packcheck-b542a.firebasestorage.app",
    messagingSenderId: "398744155641",
    appId: "1:398744155641:web:e6651ad578f4746aaeb928"
  },

  // The two (or more) Google accounts allowed to use this app.
  // These MUST also be listed in your Firestore rules (see firestore.rules).
  allowedEmails: [
    "shubhamsaxena1492@gmail.com",
    "shubhangi9237@gmail.com"
  ],

  // Collection prefix. Lets you reuse an existing Firebase project without
  // colliding with another app's data. Leave as-is unless you have a reason.
  prefix: "packcheck_"
};
