// Copy this file to config.js and fill in your values, then commit config.js.
// (These Firebase web keys are not secrets — access is controlled by ALLOWED_EMAILS
//  and your Firestore security rules, not by hiding this config.)
window.PACKCHECK = {
  // Firebase console -> Project settings -> your web app -> "SDK setup and configuration"
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  },

  // The two (or more) Google accounts allowed to use this app.
  // These MUST also be listed in your Firestore rules (see firestore.rules).
  allowedEmails: [
    "you@gmail.com",
    "partner@gmail.com"
  ],

  // Collection prefix. Lets you reuse an existing Firebase project without
  // colliding with another app's data. Leave as-is unless you have a reason.
  prefix: "packcheck_"
};
