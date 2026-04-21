// ============================================================
// FURAMORA — Main JavaScript
// Auth:     Firebase Authentication (email + password)
// Storage:  Firestore for users, bookings, reports, location
// Fallback: localStorage used only for current session data
// ============================================================


// ── LOCALSTORAGE HELPERS ─────────────────────────────────────
// These functions read and write to localStorage
// They are mainly used as a fallback when Firestore is unavailable
// and to keep the current session data in sync

// Get all users from localStorage — also makes sure admin always exists locally
function getUsers() {
    const raw = localStorage.getItem("users");
    let users = [];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) users = parsed;
        } catch (e) { users = []; }
    }

    // If no admin exists locally, add the default one
    const adminEmail = "admin@furamora.com";
    const hasAdmin   = users.some(u => u.role === "admin" && u.email === adminEmail);

    if (!hasAdmin) {
        users.push({
            id: "admin-1", name: "Furamora Admin",
            email: adminEmail, password: "admin123",
            role: "admin", active: true,
            distanceKm: null, availability: "",
            bio: "", pets: [], phone: ""
        });
        localStorage.setItem("users", JSON.stringify(users));
    }
    return users;
}

function saveUsers(users) {
    localStorage.setItem("users", JSON.stringify(users));
}

// Get bookings from localStorage (fallback only)
function getBookings() {
    const raw = localStorage.getItem("bookings");
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
}

function saveBookings(bookings) {
    localStorage.setItem("bookings", JSON.stringify(bookings));
}

// Get reports from localStorage (fallback only)
function getReports() {
    const raw = localStorage.getItem("reports");
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
}

function saveReports(reports) {
    localStorage.setItem("reports", JSON.stringify(reports));
}

// Generates a unique ID using timestamp + random number
function generateId() {
    return Date.now().toString() + "-" + Math.floor(Math.random() * 100000);
}

// Key used to store the walker's live GPS location in localStorage
const LIVE_LOCATION_KEY = "furamora_live_location";


// ── FIREBASE HELPERS ─────────────────────────────────────────
// Safe getters for Firestore and Auth
// They check if the instances are available before returning them

// Returns the Firestore db instance — tries the global first, then firebase directly
function getFirestoreDb() {
    try {
        if (typeof db !== "undefined" && db && typeof db.collection === "function") return db;
        if (typeof firebase !== "undefined" && firebase && typeof firebase.firestore === "function") {
            const firestore = firebase.firestore();
            if (typeof window !== "undefined") window.db = firestore;
            return firestore;
        }
    } catch (e) { console.error("Firestore not available:", e); }
    return null;
}

// Returns the Firebase Auth instance — tries the global first, then firebase directly
function getAuth() {
    try {
        if (typeof auth !== "undefined" && auth) return auth;
        if (typeof firebase !== "undefined" && firebase.auth) {
            const a = firebase.auth();
            window.auth = a;
            return a;
        }
    } catch (e) { console.error("Auth not available:", e); }
    return null;
}


// ── AUTH HELPERS ─────────────────────────────────────────────

// Checks the logged-in user has the correct role
// Redirects to login if not logged in, wrong role, or account is blocked/paused
function requireRole(expectedRole) {
    const raw = localStorage.getItem("currentUser");
    if (!raw) {
        alert("Please log in to access this page.");
        window.location.href = "index.html";
        return null;
    }
    let user;
    try { user = JSON.parse(raw); }
    catch (e) {
        localStorage.removeItem("currentUser");
        alert("Session error. Please log in again.");
        window.location.href = "index.html";
        return null;
    }
    if (expectedRole && user.role !== expectedRole) {
        alert("You do not have permission to view this page.");
        window.location.href = "index.html";
        return null;
    }

    // Block access if admin has blocked or paused this account
    if (user.role !== "admin") {
        if (user.accountStatus === "blocked") {
            alert("Your account has been blocked. Please contact support.");
            localStorage.removeItem("currentUser");
            window.location.href = "index.html";
            return null;
        }
        if (user.accountStatus === "paused") {
            alert("Your account is currently paused. Please contact support.");
            localStorage.removeItem("currentUser");
            window.location.href = "index.html";
            return null;
        }
    }

    return user;
}


// ── REGISTRATION ─────────────────────────────────────────────

// Creates a new account using Firebase Auth, then saves the full profile to Firestore
function registerUser() {
    const nameEl     = document.getElementById("reg-name");
    const emailEl    = document.getElementById("reg-email");
    const passwordEl = document.getElementById("reg-password");
    const roleEl     = document.getElementById("reg-role");

    if (!nameEl || !emailEl || !passwordEl || !roleEl) {
        alert("Registration form not found."); return;
    }

    const name     = nameEl.value.trim();
    const email    = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    const role     = roleEl.value;

    if (!name || !email || !password || !role) {
        alert("Please fill in all fields."); return;
    }

    if (role === "admin") {
        alert("You cannot register as an admin."); return;
    }

    const firebaseAuth = getAuth();
    const firestore    = getFirestoreDb();

    if (!firebaseAuth) {
        alert("Authentication service not available.");
        return;
    }

    // Assign a random demo distance for walkers so the distance filter works
    let distanceKm = null;
    if (role === "walker") {
        const opts = [1, 3, 5];
        distanceKm = opts[Math.floor(Math.random() * opts.length)];
    }

    // Create the user in Firebase Auth — this stores email + password securely
    firebaseAuth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            const uid = userCredential.user.uid;

            // Build the full profile object — password is never stored here
            const userProfile = {
                id:            uid,
                name,
                email,
                role,
                active:        true,
                accountStatus: "active",
                distanceKm:    distanceKm || null,
                availability:  "",
                availableDays: [],
                bio:           "",
                phone:         "",
                pets:          [],
                pawPoints:     0,        // every new user starts with 0 points
                createdAt:     new Date().toISOString()
            };

            // Save the profile to Firestore
            if (firestore) {
                return firestore.collection("users").doc(uid).set(userProfile)
                    .then(() => userProfile);
            }
            return Promise.resolve(userProfile);
        })
        .then(userProfile => {
            // Also save to localStorage for the current session
            localStorage.setItem("currentUser", JSON.stringify(userProfile));

            // Cache in the local users array too
            const users = getUsers();
            users.push({ ...userProfile, password: "" });
            saveUsers(users);

            alert("Account created successfully!");
            window.location.href = "index.html";
        })
        .catch(err => {
            console.error("Registration error:", err);
            // Show a friendly message for common Firebase error codes
            if (err.code === "auth/email-already-in-use") {
                alert("This email is already registered. Please log in instead.");
            } else if (err.code === "auth/weak-password") {
                alert("Password is too weak. Please use at least 6 characters.");
            } else if (err.code === "auth/invalid-email") {
                alert("Please enter a valid email address.");
            } else {
                alert("Registration failed: " + err.message);
            }
        });
}


// ── LOGIN ─────────────────────────────────────────────────────

// Signs the user in with Firebase Auth, loads their profile from Firestore,
// then redirects to the correct dashboard based on their role
function loginUser() {
    const emailEl    = document.getElementById("login-email");
    const passwordEl = document.getElementById("login-password");
    const roleEl     = document.getElementById("loginRole");

    if (!emailEl || !passwordEl || !roleEl) {
        alert("Login form not found."); return;
    }

    const email    = emailEl.value.trim().toLowerCase();
    const password = passwordEl.value;
    const role     = roleEl.value;

    if (!email || !password || !role) {
        alert("Please enter your email, password and role."); return;
    }

    // Admin login is handled separately — it uses localStorage only for the prototype
    if (role === "admin") {
        const users  = getUsers();
        const admin  = users.find(u =>
            u.email === email && u.password === password && u.role === "admin"
        );
        if (!admin) {
            alert("Invalid admin credentials."); return;
        }
        localStorage.setItem("currentUser", JSON.stringify(admin));
        window.location.href = "admin.html";
        return;
    }

    const firebaseAuth = getAuth();
    const firestore    = getFirestoreDb();

    if (!firebaseAuth) {
        alert("Authentication service not available."); return;
    }

    // Sign in with Firebase Auth
    firebaseAuth.signInWithEmailAndPassword(email, password)
        .then(userCredential => {
            const uid = userCredential.user.uid;

            // Load the full profile from Firestore
            if (firestore) {
                return firestore.collection("users").doc(uid).get()
                    .then(doc => {
                        if (!doc.exists) {
                            throw new Error("User profile not found in database.");
                        }
                        return doc.data();
                    });
            }
            // Fallback: build a minimal profile from Auth data only
            return { id: uid, email, role, name: "" };
        })
        .then(userProfile => {
            // Make sure the role on the form matches the role stored in Firestore
            if (userProfile.role !== role) {
                firebaseAuth.signOut();
                alert("Incorrect role selected. Please choose the correct role.");
                return;
            }

            // Prevent blocked or paused accounts from logging in
            if (userProfile.accountStatus === "blocked") {
                firebaseAuth.signOut();
                alert("Your account has been blocked. Please contact support.");
                return;
            }
            if (userProfile.accountStatus === "paused") {
                firebaseAuth.signOut();
                alert("Your account is currently paused. Please contact support.");
                return;
            }

            // Save profile to localStorage for the session
            localStorage.setItem("currentUser", JSON.stringify(userProfile));

            // Redirect to the right dashboard based on role
            if (role === "walker") window.location.href = "walker.html";
            else                   window.location.href = "owner.html";
        })
        .catch(err => {
            console.error("Login error:", err);
            // Show friendly messages for common Firebase Auth error codes
            const code = err.code || "";
            if (
                code === "auth/user-not-found"      ||
                code === "auth/wrong-password"       ||
                code === "auth/invalid-credential"   ||
                code === "auth/invalid-login-credentials" ||
                (err.message && err.message.includes("INVALID_LOGIN_CREDENTIALS"))
            ) {
                alert("Incorrect email or password. Please try again.");
            } else if (code === "auth/too-many-requests") {
                alert("Too many failed attempts. Please wait a moment and try again.");
            } else if (code === "auth/user-disabled") {
                alert("This account has been disabled. Please contact support.");
            } else if (code === "auth/network-request-failed") {
                alert("Network error. Please check your connection and try again.");
            } else {
                alert("Login failed. Please check your details and try again.");
            }
        });
}


// ── OWNER DASHBOARD ───────────────────────────────────────────

// Checks Firebase Auth session then loads the owner dashboard
// The authSettled flag prevents false logouts when switching browser tabs
function initOwnerDashboard() {
    const firebaseAuth = getAuth();

    if (firebaseAuth) {
        let authSettled = false;

        firebaseAuth.onAuthStateChanged(firebaseUser => {
            if (firebaseUser) {
                // Session confirmed — load the dashboard straight away
                authSettled = true;
                const user = requireRole("owner");
                if (!user) return;
                _runOwnerDashboard(user);
            } else {
                // Auth fired null — could be a tab switch or a genuine logout.
                // Wait 3 seconds before treating it as a real logout so Firebase
                // has time to restore the session when switching back to this tab.
                setTimeout(() => {
                    if (authSettled) return; // session came back, ignore
                    localStorage.removeItem("currentUser");
                    alert("Please log in to access this page.");
                    window.location.href = "index.html";
                }, 3000);
            }
        });
    } else {
        // Firebase Auth not available — fall back to localStorage only
        const user = requireRole("owner");
        if (!user) return;
        _runOwnerDashboard(user);
    }
}

// Calls all the render functions needed to populate the owner dashboard
function _runOwnerDashboard(user) {
    fillOwnerProfile(user);
    renderPets(user);
    renderOwnerBookings(user);
    renderWalkersForOwner();
    renderOwnerReports(user);
    renderOwnerWalkHistory(user);
    renderPawPoints(user);
}

// On page load: fills the profile form with saved values
// If the owner has already saved a profile, shows the read-only display card instead
function fillOwnerProfile(user) {
    const nameEl  = document.getElementById("owner-name");
    const phoneEl = document.getElementById("owner-phone");

    if (nameEl)  nameEl.value  = user.name  || "";
    if (phoneEl) phoneEl.value = user.phone || "";

    const hasProfile = user.name && user.name.trim() !== "";

    if (hasProfile) {
        // Populate the display card spans before showing it
        const nameShow  = document.getElementById("display-name");
        const phoneShow = document.getElementById("display-phone");
        if (nameShow)  nameShow.textContent  = user.name  || "";
        if (phoneShow) phoneShow.textContent = user.phone || "Not set";

        const display  = document.getElementById("profile-display");
        const formArea = document.getElementById("owner-profile-form");
        if (display)  display.style.display  = "block";
        if (formArea) formArea.style.display = "none";
    } else {
        // First visit — show the form with "Save Profile" button
        const display  = document.getElementById("profile-display");
        const formArea = document.getElementById("owner-profile-form");
        if (display)  display.style.display  = "none";
        if (formArea) formArea.style.display = "block";

        const btn = document.getElementById("save-profile-btn");
        if (btn) btn.textContent = "Save Profile";
    }
}

// Called when the Edit button is clicked — hides display card, shows form
// Button label changes to "Update Profile" since a profile already exists
function enableProfileEdit() {
    const raw = localStorage.getItem("currentUser");
    if (raw) {
        try {
            const u = JSON.parse(raw);
            const nameEl  = document.getElementById("owner-name");
            const phoneEl = document.getElementById("owner-phone");
            if (nameEl)  nameEl.value  = u.name  || "";
            if (phoneEl) phoneEl.value = u.phone || "";
        } catch (e) {}
    }

    const btn = document.getElementById("save-profile-btn");
    if (btn) btn.textContent = "Update Profile";

    const display  = document.getElementById("profile-display");
    const formArea = document.getElementById("owner-profile-form");
    if (display)  display.style.display  = "none";
    if (formArea) formArea.style.display = "block";
}

// Saves the owner's name and phone to Firestore and localStorage
// Then switches back to the read-only display card
function saveOwnerProfile() {
    const user = requireRole("owner");
    if (!user) return;

    const nameEl  = document.getElementById("owner-name");
    const phoneEl = document.getElementById("owner-phone");

    if (!nameEl || !phoneEl) { alert("Profile fields not found."); return; }

    const name  = nameEl.value.trim();
    const phone = phoneEl.value.trim();

    if (!name)  { alert("Please enter your name."); return; }
    if (!phone) { alert("Please enter your phone number."); return; }

    const firestore = getFirestoreDb();

    if (firestore) {
        // merge:true means only these fields are updated, nothing else is overwritten
        firestore.collection("users").doc(user.id).set({
            id: user.id, name, email: user.email,
            role: user.role, active: user.active,
            accountStatus: user.accountStatus || "active",
            distanceKm:   user.distanceKm   || null,
            availability: user.availability || "",
            bio:          user.bio          || "",
            phone,
            pets: user.pets || []
        }, { merge: true })
        .then(() => console.log("Owner profile saved to Firestore"))
        .catch(err => console.error("Firestore error:", err));
    }

    // Keep the local session in sync
    const updatedUser = { ...user, name, phone };
    localStorage.setItem("currentUser", JSON.stringify(updatedUser));

    // Update localStorage cache
    const users = getUsers();
    const idx   = users.findIndex(u => u.id === user.id);
    if (idx >= 0) { users[idx].name = name; users[idx].phone = phone; saveUsers(users); }

    // Update the display card spans
    const nameShow  = document.getElementById("display-name");
    const phoneShow = document.getElementById("display-phone");
    if (nameShow)  nameShow.textContent  = name;
    if (phoneShow) phoneShow.textContent = phone;

    // Show display card, hide form (button disappears with the form)
    const display  = document.getElementById("profile-display");
    const formArea = document.getElementById("owner-profile-form");
    if (display)  display.style.display  = "block";
    if (formArea) formArea.style.display = "none";

    alert("Profile saved!");
}


// ── PETS ──────────────────────────────────────────────────────

// Renders the owner's saved pets as cards in the pet list
function renderPets(user) {
    const list = document.getElementById("pet-list");
    if (!list) return;

    const pets = Array.isArray(user.pets) ? user.pets : [];

    if (pets.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🐕</div>No pets added yet.</div>';
        return;
    }

    list.innerHTML = "";
    pets.forEach(pet => {
        const item = document.createElement("div");
        item.className = "pet-card";
        item.innerHTML = `
            <div class="pet-avatar">🐾</div>
            <div class="pet-card-info">
                <strong>${pet.name}</strong>
                <span>${pet.type}${pet.notes ? " · " + pet.notes : ""}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

// Adds a new pet to the owner's profile and saves it to Firestore
function addPet() {
    const user = requireRole("owner");
    if (!user) return;

    const nameEl  = document.getElementById("pet-name");
    const typeEl  = document.getElementById("pet-type");
    const notesEl = document.getElementById("pet-notes");

    if (!nameEl || !typeEl || !notesEl) return;

    const name  = nameEl.value.trim();
    const type  = typeEl.value.trim();
    const notes = notesEl.value.trim();

    if (!name || !type) { alert("Please enter pet name and type."); return; }

    const newPet  = { id: generateId(), name, type, notes };
    const pets    = Array.isArray(user.pets) ? [...user.pets, newPet] : [newPet];
    const updated = { ...user, pets };

    // Save the updated pets array to Firestore
    const firestore = getFirestoreDb();
    if (firestore) {
        firestore.collection("users").doc(user.id).update({ pets })
            .then(() => console.log("Pet saved to Firestore"))
            .catch(err => console.error("Firestore pet error:", err));
    }

    // Keep the local session in sync
    localStorage.setItem("currentUser", JSON.stringify(updated));
    const users = getUsers();
    const idx   = users.findIndex(u => u.id === user.id);
    if (idx >= 0) { users[idx].pets = pets; saveUsers(users); }

    // Clear the form and re-render the list
    nameEl.value = ""; typeEl.value = ""; notesEl.value = "";
    renderPets(updated);
}


// ── OWNER BOOKINGS ────────────────────────────────────────────

// Loads the owner's bookings from Firestore using a real-time listener
// so the status updates automatically when a walker accepts or declines
function renderOwnerBookings(user) {
    const list = document.getElementById("owner-bookings");
    if (!list) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div>Loading bookings...</div>';

        // onSnapshot means the list updates live without needing a page refresh
        firestore.collection("bookings")
            .where("ownerId", "==", user.id)
            .onSnapshot(snapshot => {
                const bookings = [];
                snapshot.forEach(doc => bookings.push(doc.data()));
                renderOwnerBookingsList(list, bookings);
            }, err => {
                console.error("Firestore error:", err);
                renderOwnerBookingsList(list, getBookings().filter(b => b.ownerId === user.id));
            });
    } else {
        renderOwnerBookingsList(list, getBookings().filter(b => b.ownerId === user.id));
    }
}

// Builds and renders the booking cards with colour-coded status badges
function renderOwnerBookingsList(list, bookings) {
    list.innerHTML = "";

    if (bookings.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div>No bookings yet.</div>';
        return;
    }

    // Show newest bookings first
    bookings.sort((a, b) =>
        (b.createdAt || "").toString().localeCompare((a.createdAt || "").toString())
    );

    bookings.forEach(b => {
        // Pick the right badge colour for this booking's status
        const cls = {
            "Pending":    "badge-pending",
            "Accepted":   "badge-accepted",
            "Completed":  "badge-completed",
            "Declined":   "badge-declined",
            "InProgress": "badge-inprogress"
        }[b.status] || "badge-pending";

        const item = document.createElement("div");
        item.className = "booking-item";
        item.innerHTML = `
            <div class="booking-item-header">
                <strong>${b.service || "Dog Walk"}</strong>
                <span class="badge ${cls}">${b.status}</span>
            </div>
            <p>📅 ${b.date} at ${b.time}</p>
            <p>🦮 Walker: ${b.walkerName || "Not yet assigned"}</p>
        `;
        list.appendChild(item);
    });
}

// Creates a new booking and saves it to Firestore with status "Pending"
function saveBooking() {
    const user = requireRole("owner");
    if (!user) return;

    const serviceEl = document.getElementById("booking-service");
    const dateEl    = document.getElementById("booking-date");
    const timeEl    = document.getElementById("booking-time");

    if (!serviceEl || !dateEl || !timeEl) { alert("Booking form not found."); return; }

    const service = serviceEl.value || "Dog Walk";
    const date    = dateEl.value;
    const time    = timeEl.value;

    if (!date || !time) { alert("Please select a date and time."); return; }

    const bookingId = generateId();
    const booking   = {
        id: bookingId,
        ownerId:   user.id,
        ownerName: user.name || "",
        walkerId:  null, walkerName: "",
        service, date, time,
        status:    "Pending",
        createdAt: new Date().toISOString()
    };

    // Save the booking to Firestore
    const firestore = getFirestoreDb();
    if (firestore) {
        firestore.collection("bookings").doc(bookingId).set(booking)
            .then(() => {
                console.log("Booking saved to Firestore");
                alert("Booking submitted!");
                dateEl.value = ""; timeEl.value = "";
            })
            .catch(err => {
                console.error("Firestore booking error:", err);
                alert("Failed to save booking: " + err.message);
            });
    } else {
        // Fallback to localStorage if Firestore is unavailable
        const bookings = getBookings();
        bookings.push(booking);
        saveBookings(bookings);
        alert("Booking submitted!");
        dateEl.value = ""; timeEl.value = "";
        renderOwnerBookings(user);
    }
}


// ── WALKERS LIST ─────────────────────────────────────────────

// Loads active walkers from Firestore for the owner to browse
// Filters out blocked/paused walkers and applies the distance filter if set
function renderWalkersForOwner() {
    const list = document.getElementById("walker-list");
    if (!list) return;

    const distanceFilter = document.getElementById("distance-filter");
    const maxDistance    = distanceFilter && distanceFilter.value
        ? Number(distanceFilter.value) : null;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("users")
            .where("role", "==", "walker")
            .where("active", "==", true)
            .get()
            .then(snapshot => {
                const walkers = [];
                snapshot.forEach(doc => walkers.push(doc.data()));

                // Remove walkers who have been blocked or paused by admin
                const available = walkers.filter(w => {
                    if (w.accountStatus === "blocked" || w.accountStatus === "paused") return false;
                    if (!maxDistance) return true;
                    return typeof w.distanceKm === "number" && w.distanceKm <= maxDistance;
                });

                displayWalkersList(list, available);
            })
            .catch(err => {
                console.error("Firestore walkers error:", err);
                displayWalkersList(list, getUsers().filter(u => u.role === "walker" && u.active !== false));
            });
    } else {
        const walkers = getUsers().filter(u => {
            if (u.role !== "walker" || u.active === false) return false;
            if (u.accountStatus === "blocked" || u.accountStatus === "paused") return false;
            if (!maxDistance) return true;
            return typeof u.distanceKm === "number" && u.distanceKm <= maxDistance;
        });
        displayWalkersList(list, walkers);
    }
}

// Builds the HTML for each walker card in the list
function displayWalkersList(list, walkers) {
    if (walkers.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div>No walkers match this filter.</div>';
        return;
    }

    list.innerHTML = "";
    walkers.forEach(w => {
        const item = document.createElement("div");
        item.className = "walker-card";
        item.innerHTML = `
            <div class="walker-card-header">
                <strong>${w.name}</strong>
                <span class="distance-badge">📍 ${w.distanceKm || "?"} km</span>
            </div>
            <p>🕐 ${w.availability || "Availability not set"}</p>
            <p>${w.bio || "No bio yet."}</p>
        `;
        list.appendChild(item);
    });
}

// Called when the owner clicks the Search button on the distance filter
function applyWalkerFilter() { renderWalkersForOwner(); }


// ── OWNER REPORTS ─────────────────────────────────────────────

// Loads walk reports for this owner from Firestore and renders them
function renderOwnerReports(user) {
    const container = document.getElementById("owner-reports");
    if (!container) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("reports")
            .where("ownerId", "==", user.id)
            .get()
            .then(snapshot => {
                const reports = [];
                snapshot.forEach(doc => reports.push(doc.data()));
                displayOwnerReports(container, reports);
            })
            .catch(err => {
                console.error("Reports error:", err);
                displayOwnerReports(container, getReports().filter(r => r.ownerId === user.id));
            });
    } else {
        displayOwnerReports(container, getReports().filter(r => r.ownerId === user.id));
    }
}

// Builds the HTML for each report card
function displayOwnerReports(container, reports) {
    if (reports.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>No walk reports yet.</div>';
        return;
    }

    container.innerHTML = "";
    reports.forEach(r => {
        const item = document.createElement("div");
        item.className = "report-card";
        item.innerHTML = `
            <div class="report-card-header">
                <strong>${r.date} · ${r.time}</strong>
                <span style="font-size:0.8rem;color:var(--text-soft);">By ${r.walkerName || "Unknown"}</span>
            </div>
            <p>${r.text}</p>
        `;
        container.appendChild(item);
    });
}


// ── OWNER WALK HISTORY ────────────────────────────────────────

// Loads all completed walks for this owner from Firestore
function renderOwnerWalkHistory(user) {
    const container = document.getElementById("owner-walk-history");
    if (!container) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("bookings")
            .where("ownerId", "==", user.id)
            .where("status", "==", "Completed")
            .get()
            .then(snapshot => {
                const completed = [];
                snapshot.forEach(doc => completed.push(doc.data()));
                displayWalkHistory(container, completed);
            })
            .catch(err => {
                console.error("Walk history error:", err);
                displayWalkHistory(container,
                    getBookings().filter(b => b.ownerId === user.id && b.status === "Completed")
                );
            });
    } else {
        displayWalkHistory(container,
            getBookings().filter(b => b.ownerId === user.id && b.status === "Completed")
        );
    }
}

// Builds the HTML for each completed walk row, sorted newest first
function displayWalkHistory(container, completed) {
    if (completed.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🐾</div>No completed walks yet.</div>';
        return;
    }

    completed.sort((a, b) => b.date.localeCompare(a.date));
    container.innerHTML = "";

    completed.forEach(b => {
        const item = document.createElement("div");
        item.className = "history-item";
        item.innerHTML = `
            <div class="history-item-left">
                <strong>${b.service || "Dog Walk"}</strong>
                <span>📅 ${b.date} · 🦮 ${b.walkerName || "Unknown"}</span>
            </div>
            <span class="badge badge-completed">Completed</span>
        `;
        container.appendChild(item);
    });
}


// ── WALKER DASHBOARD ──────────────────────────────────────────

// Checks Firebase Auth session then loads the walker dashboard
// Same tab-switch fix as the owner — waits 3 seconds before redirecting on null auth
function initWalkerDashboard() {
    const firebaseAuth = getAuth();

    if (firebaseAuth) {
        let authSettled = false;

        firebaseAuth.onAuthStateChanged(firebaseUser => {
            if (firebaseUser) {
                // Session confirmed — load the dashboard straight away
                authSettled = true;
                const user = requireRole("walker");
                if (!user) return;
                _runWalkerDashboard(user);
            } else {
                // Auth fired null — could be a tab switch or a genuine logout.
                // Wait 3 seconds before treating it as a real logout so Firebase
                // has time to restore the session when switching back to this tab.
                setTimeout(() => {
                    if (authSettled) return; // session came back, ignore
                    localStorage.removeItem("currentUser");
                    alert("Please log in to access this page.");
                    window.location.href = "index.html";
                }, 3000);
            }
        });
    } else {
        const user = requireRole("walker");
        if (!user) return;
        _runWalkerDashboard(user);
    }
}

// Calls all the render functions needed to populate the walker dashboard
function _runWalkerDashboard(user) {
    fillWalkerProfile(user);
    renderWalkerBookings(user);
    renderWalkerWalkHistory(user);
    updateLiveLocationStatus();
}

// On page load: populates the form and decides whether to show the display card or the form
// NOTE: walker.html overrides this to also handle the day-picker — this is the base fallback
function fillWalkerProfile(user) {
    const nameEl  = document.getElementById("walker-name");
    const phoneEl = document.getElementById("walker-phone");
    const bioEl   = document.getElementById("walker-bio");

    if (nameEl)  nameEl.value  = user.name  || "";
    if (phoneEl) phoneEl.value = user.phone || "";
    if (bioEl)   bioEl.value   = user.bio   || "";

    const hasProfile = user.name && user.name.trim() !== "";

    if (hasProfile) {
        const nameShow  = document.getElementById("display-walker-name");
        const phoneShow = document.getElementById("display-walker-phone");
        const bioShow   = document.getElementById("display-walker-bio");
        if (nameShow)  nameShow.textContent  = user.name  || "";
        if (phoneShow) phoneShow.textContent = user.phone || "Not set";
        if (bioShow)   bioShow.textContent   = user.bio   || "No bio yet.";

        const display  = document.getElementById("walker-profile-display");
        const formArea = document.getElementById("walker-profile-form");
        if (display)  display.style.display  = "block";
        if (formArea) formArea.style.display = "none";
    } else {
        // First visit — show the form with "Save Profile" button
        const display  = document.getElementById("walker-profile-display");
        const formArea = document.getElementById("walker-profile-form");
        if (display)  display.style.display  = "none";
        if (formArea) formArea.style.display = "block";

        const btn = document.getElementById("save-walker-btn");
        if (btn) btn.textContent = "Save Profile";
    }
}

// Called when the Edit button is clicked — hides the display card, shows the form
// NOTE: walker.html overrides this to also restore day-picker state
function enableWalkerProfileEdit() {
    const raw = localStorage.getItem("currentUser");
    if (raw) {
        try {
            const u = JSON.parse(raw);
            const nameEl  = document.getElementById("walker-name");
            const phoneEl = document.getElementById("walker-phone");
            const bioEl   = document.getElementById("walker-bio");
            if (nameEl)  nameEl.value  = u.name  || "";
            if (phoneEl) phoneEl.value = u.phone || "";
            if (bioEl)   bioEl.value   = u.bio   || "";
        } catch (e) {}
    }

    // Change button label since this is an edit, not a first save
    const btn = document.getElementById("save-walker-btn");
    if (btn) btn.textContent = "Update Profile";

    const display  = document.getElementById("walker-profile-display");
    const formArea = document.getElementById("walker-profile-form");
    if (display)  display.style.display  = "none";
    if (formArea) formArea.style.display = "block";
}

// Saves the walker's profile to Firestore and localStorage
// NOTE: walker.html overrides this to also save availableDays from the day picker
function saveWalkerProfile() {
    const user = requireRole("walker");
    if (!user) return;

    const nameEl  = document.getElementById("walker-name");
    const phoneEl = document.getElementById("walker-phone");
    const bioEl   = document.getElementById("walker-bio");

    if (!nameEl || !phoneEl || !bioEl) { alert("Profile fields not found."); return; }

    const name  = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    const bio   = bioEl.value.trim();

    if (!name)  { alert("Please enter your name."); return; }
    if (!phone) { alert("Please enter your phone number."); return; }

    const firestore = getFirestoreDb();

    if (firestore) {
        // merge:true so we don't accidentally wipe other fields like accountStatus
        firestore.collection("users").doc(user.id).set({
            id: user.id, name, email: user.email,
            role: user.role, active: user.active,
            accountStatus: user.accountStatus || "active",
            distanceKm:    user.distanceKm    || null,
            availability:  user.availability  || "",
            availableDays: user.availableDays || [],
            bio, phone,
            pets: user.pets || []
        }, { merge: true })
        .then(() => console.log("Walker profile saved to Firestore"))
        .catch(err => console.error("Firestore error:", err));
    }

    // Keep the local session in sync
    const updatedUser = { ...user, name, phone, bio };
    localStorage.setItem("currentUser", JSON.stringify(updatedUser));

    // Update localStorage cache
    const users = getUsers();
    const idx   = users.findIndex(u => u.id === user.id);
    if (idx >= 0) {
        users[idx].name  = name;
        users[idx].phone = phone;
        users[idx].bio   = bio;
        saveUsers(users);
    }

    // Populate the display card spans
    const nameShow  = document.getElementById("display-walker-name");
    const phoneShow = document.getElementById("display-walker-phone");
    const bioShow   = document.getElementById("display-walker-bio");
    if (nameShow)  nameShow.textContent  = name;
    if (phoneShow) phoneShow.textContent = phone;
    if (bioShow)   bioShow.textContent   = bio || "No bio yet.";

    // Show display card, hide form (button disappears with the form)
    const display  = document.getElementById("walker-profile-display");
    const formArea = document.getElementById("walker-profile-form");
    if (display)  display.style.display  = "block";
    if (formArea) formArea.style.display = "none";

    alert("Profile saved!");
}


// ── WALKER BOOKINGS ───────────────────────────────────────────

// Loads all bookings using a real-time listener so the list updates instantly
// Shows all pending requests (any owner) and this walker's own accepted bookings
function renderWalkerBookings(user) {
    const pendingEl   = document.getElementById("pendingBookings");
    const confirmedEl = document.getElementById("confirmedBookings");
    if (!pendingEl || !confirmedEl) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        pendingEl.innerHTML   = '<div class="empty-state"><div class="empty-icon">⏳</div>Loading...</div>';
        confirmedEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div>Loading...</div>';

        // Real-time listener — updates automatically when any booking changes
        firestore.collection("bookings").onSnapshot(snapshot => {
            const all = [];
            snapshot.forEach(doc => all.push(doc.data()));
            displayWalkerBookings(user, all, pendingEl, confirmedEl);
        }, err => {
            console.error("Firestore error:", err);
            displayWalkerBookings(user, getBookings(), pendingEl, confirmedEl);
        });
    } else {
        displayWalkerBookings(user, getBookings(), pendingEl, confirmedEl);
    }
}

// Splits bookings into pending (all owners) and mine (accepted/completed by this walker)
// Pending cards also show the owner's Paw Points loaded from Firestore
function displayWalkerBookings(user, allBookings, pendingEl, confirmedEl) {
    const pending = allBookings.filter(b => b.status === "Pending");
    const mine    = allBookings.filter(b =>
        b.walkerId === user.id &&
        (b.status === "Accepted" || b.status === "Completed" || b.status === "InProgress")
    );

    pendingEl.innerHTML   = "";
    confirmedEl.innerHTML = "";

    if (pending.length === 0) {
        pendingEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div>No pending requests right now.</div>';
    } else {
        pending.forEach(b => {
            const item     = document.createElement("div");
            item.className = "booking-item";
            const safeUser = JSON.stringify(user).replace(/"/g, "&quot;");

            // Card renders immediately with a placeholder for points
            // _loadOwnerPawPoints then fetches the real value and fills it in
            item.innerHTML = `
                <div class="booking-item-header">
                    <strong>${b.service || "Dog Walk"}</strong>
                    <span class="badge badge-pending">Pending</span>
                </div>
                <p>👤 Owner: ${b.ownerName || "Unknown"}</p>
                <p style="font-size:0.82rem; color:var(--accent); font-weight:600;"
                   id="paw-points-${b.id}">🏅 Loading points...</p>
                <p>📅 ${b.date} at ${b.time}</p>
                <div class="booking-item-actions">
                    <button class="btn-accept"
                            onclick="updateBookingStatus('${b.id}', 'Accepted', ${safeUser})">
                        ✓ Accept
                    </button>
                    <button class="btn-decline"
                            onclick="updateBookingStatus('${b.id}', 'Declined', ${safeUser})">
                        ✗ Decline
                    </button>
                </div>
            `;
            pendingEl.appendChild(item);

            // Fetch the owner's Paw Points and replace the placeholder
            _loadOwnerPawPoints(b.ownerId, b.id);
        });
    }

    if (mine.length === 0) {
        confirmedEl.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div>No confirmed bookings yet.</div>';
    } else {
        mine.forEach(b => {
            // Pick the right badge colour for this booking's status
            const cls = {
                "Accepted":   "badge-accepted",
                "InProgress": "badge-inprogress",
                "Completed":  "badge-completed"
            }[b.status] || "badge-accepted";

            const item     = document.createElement("div");
            item.className = "booking-item";
            item.innerHTML = `
                <div class="booking-item-header">
                    <strong>${b.service || "Dog Walk"}</strong>
                    <span class="badge ${cls}">${b.status}</span>
                </div>
                <p>👤 Owner: ${b.ownerName || "Unknown"}</p>
                <p>📅 ${b.date} at ${b.time}</p>
            `;
            confirmedEl.appendChild(item);
        });
    }
}

// Fetches the owner's Paw Points from Firestore and updates the placeholder
// on the pending booking card — falls back to localStorage if Firestore fails
function _loadOwnerPawPoints(ownerId, bookingId) {
    const el = document.getElementById("paw-points-" + bookingId);
    if (!el) return;

    const firestore = getFirestoreDb();

    if (firestore && ownerId) {
        firestore.collection("users").doc(ownerId).get()
            .then(doc => {
                const points = doc.exists ? (doc.data().pawPoints || 0) : 0;
                el.textContent = _formatPawPointsLabel(points);
            })
            .catch(() => {
                const cached = getUsers().find(u => u.id === ownerId);
                const points = cached ? (cached.pawPoints || 0) : 0;
                el.textContent = _formatPawPointsLabel(points);
            });
    } else {
        const cached = getUsers().find(u => u.id === ownerId);
        const points = cached ? (cached.pawPoints || 0) : 0;
        el.textContent = _formatPawPointsLabel(points);
    }
}

// Formats the Paw Points line shown on each pending booking card
// e.g. "🏅 30 Paw Points · Bronze 🥉"
function _formatPawPointsLabel(points) {
    let tier;
    if      (points >= 200) tier = "Gold 🏆";
    else if (points >= 100) tier = "Silver 🥈";
    else if (points >= 50)  tier = "Bronze 🥉";
    else                    tier = "Starter 🐾";
    return `🏅 ${points} Paw Points · ${tier}`;
}

// Updates the booking status in Firestore when the walker accepts or declines
// If accepted, also stores the walker's ID and name on the booking document
function updateBookingStatus(bookingId, status, walker) {
    const firestore = getFirestoreDb();
    const update    = { status };

    if (status === "Accepted") {
        update.walkerId   = walker.id;
        update.walkerName = walker.name;
    }

    if (firestore) {
        firestore.collection("bookings").doc(bookingId).update(update)
            .then(() => console.log("Booking status updated"))
            .catch(err => console.error("Update error:", err));
    } else {
        // Fallback: update localStorage
        const bookings = getBookings();
        const idx      = bookings.findIndex(b => b.id === bookingId);
        if (idx >= 0) {
            bookings[idx].status = status;
            if (status === "Accepted") {
                bookings[idx].walkerId   = walker.id;
                bookings[idx].walkerName = walker.name;
            }
            saveBookings(bookings);
        }
        renderWalkerBookings(walker);
    }
}


// ── WALKER WALK HISTORY ───────────────────────────────────────

// Loads accepted and completed walks for this walker from Firestore
function renderWalkerWalkHistory(user) {
    const container = document.getElementById("walker-walk-history");
    if (!container) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("bookings")
            .where("walkerId", "==", user.id)
            .get()
            .then(snapshot => {
                const done = [];
                snapshot.forEach(doc => {
                    const b = doc.data();
                    if (b.status === "Completed" || b.status === "Accepted") done.push(b);
                });
                displayWalkerHistory(container, done);
            })
            .catch(err => {
                console.error("Walk history error:", err);
                displayWalkerHistory(container,
                    getBookings().filter(b =>
                        b.walkerId === user.id &&
                        (b.status === "Completed" || b.status === "Accepted")
                    )
                );
            });
    } else {
        displayWalkerHistory(container,
            getBookings().filter(b =>
                b.walkerId === user.id &&
                (b.status === "Completed" || b.status === "Accepted")
            )
        );
    }
}

// Builds the HTML for each walk history row, sorted newest first
function displayWalkerHistory(container, done) {
    if (done.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🐾</div>No walk history yet.</div>';
        return;
    }

    done.sort((a, b) => b.date.localeCompare(a.date));
    container.innerHTML = "";

    done.forEach(b => {
        const cls  = b.status === "Completed" ? "badge-completed" : "badge-accepted";
        const item = document.createElement("div");
        item.className = "history-item";
        item.innerHTML = `
            <div class="history-item-left">
                <strong>${b.service || "Dog Walk"}</strong>
                <span>📅 ${b.date} · 👤 ${b.ownerName || "Unknown"}</span>
            </div>
            <span class="badge ${cls}">${b.status}</span>
        `;
        container.appendChild(item);
    });
}


// ── WALK REPORT ───────────────────────────────────────────────

// Submits a walk report and attaches it to the walker's most recent accepted booking
// Also awards 10 Paw Points to the owner when the report is saved
function submitReport() {
    const user = requireRole("walker");
    if (!user) return;

    const textEl = document.getElementById("reportText");
    if (!textEl) return;

    const text = textEl.value.trim();
    if (!text) { alert("Please write a report before submitting."); return; }

    const firestore = getFirestoreDb();

    if (firestore) {
        // Find the most recent accepted booking for this walker
        firestore.collection("bookings")
            .where("walkerId", "==", user.id)
            .where("status",   "==", "Accepted")
            .get()
            .then(snapshot => {
                if (snapshot.empty) {
                    alert("No accepted booking found to attach this report to.");
                    return;
                }

                const bookings = [];
                snapshot.forEach(doc => bookings.push(doc.data()));
                // Sort to get the most recent booking
                bookings.sort((a, b) =>
                    a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
                );
                const latest = bookings[bookings.length - 1];

                const reportId = generateId();
                const report   = {
                    id:         reportId,
                    bookingId:  latest.id,
                    ownerId:    latest.ownerId,
                    walkerId:   user.id,
                    walkerName: user.name || "",
                    date:       latest.date,
                    time:       latest.time,
                    text,
                    createdAt:  new Date().toISOString()
                };

                // Save the report to Firestore
                return firestore.collection("reports").doc(reportId).set(report)
                    .then(() => report);
            })
            .then(report => {
                if (!report) return;

                // Also cache in localStorage
                const reports = getReports();
                reports.push(report);
                saveReports(reports);
                localStorage.setItem("latestWalkReport", text);

                // Award 10 Paw Points to the owner for this completed walk
                awardPawPoints(report.ownerId, 10);

                alert("Report submitted.");
                textEl.value = "";
            })
            .catch(err => {
                console.error("Report submit error:", err);
                alert("Failed to submit report: " + err.message);
            });
    } else {
        // Fallback: save report to localStorage only
        const bookings = getBookings()
            .filter(b => b.walkerId === user.id && b.status === "Accepted")
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

        if (bookings.length === 0) {
            alert("No accepted booking found."); return;
        }

        const latest   = bookings[bookings.length - 1];
        const reportId = generateId();
        const reports  = getReports();

        reports.push({
            id: reportId, bookingId: latest.id,
            ownerId: latest.ownerId, walkerId: user.id,
            walkerName: user.name || "",
            date: latest.date, time: latest.time,
            text, createdAt: new Date().toISOString()
        });

        saveReports(reports);
        localStorage.setItem("latestWalkReport", text);

        // Award 10 Paw Points to the owner for this completed walk
        awardPawPoints(latest.ownerId, 10);

        alert("Report submitted.");
        textEl.value = "";
    }
}


// ── PAW POINTS ────────────────────────────────────────────────

// How many points are awarded per completed walk
const PAW_POINTS_PER_WALK = 10;

// Awards Paw Points to an owner when a walk is completed
// Uses a Firestore transaction so concurrent updates don't overwrite each other
function awardPawPoints(ownerId, points) {
    if (!ownerId) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        const userRef = firestore.collection("users").doc(ownerId);

        // Transaction reads the current value, adds points, then writes it back atomically
        firestore.runTransaction(transaction => {
            return transaction.get(userRef).then(doc => {
                if (!doc.exists) return;
                const current = doc.data().pawPoints || 0;
                transaction.update(userRef, { pawPoints: current + points });
            });
        })
        .then(() => {
            // Also update localStorage so the UI reflects the change immediately
            _syncPawPointsToSession(ownerId, points);
            console.log(`Awarded ${points} Paw Points to owner ${ownerId}`);
        })
        .catch(err => console.error("Paw Points award error:", err));

    } else {
        // Firestore not available — update localStorage only
        _syncPawPointsToSession(ownerId, points);
    }
}

// Keeps the Paw Points value in sync in the current session and local cache
function _syncPawPointsToSession(ownerId, pointsToAdd) {
    // Update currentUser session if this is the logged-in owner
    const raw = localStorage.getItem("currentUser");
    if (raw) {
        try {
            const u = JSON.parse(raw);
            if (u.id === ownerId) {
                u.pawPoints = (u.pawPoints || 0) + pointsToAdd;
                localStorage.setItem("currentUser", JSON.stringify(u));
            }
        } catch (e) {}
    }

    // Also update the local users cache
    const users = getUsers();
    const idx   = users.findIndex(u => u.id === ownerId);
    if (idx >= 0) {
        users[idx].pawPoints = (users[idx].pawPoints || 0) + pointsToAdd;
        saveUsers(users);
    }
}

// Loads the owner's current Paw Points from Firestore and displays them
// The base version just updates the balance number and tier label
// owner.html overrides this to also drive the progress bar
function renderPawPoints(user) {
    const el = document.getElementById("paw-points-balance");
    if (!el) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("users").doc(user.id).get()
            .then(doc => {
                const points = doc.exists ? (doc.data().pawPoints || 0) : 0;
                el.textContent = points;
                _updatePointsTier(points);
            })
            .catch(() => {
                // Fallback to session value if Firestore fails
                const points = user.pawPoints || 0;
                el.textContent = points;
                _updatePointsTier(points);
            });
    } else {
        const points = user.pawPoints || 0;
        el.textContent = points;
        _updatePointsTier(points);
    }
}

// Updates the tier label and colour next to the points balance
function _updatePointsTier(points) {
    const tierEl = document.getElementById("paw-points-tier");
    if (!tierEl) return;

    let tier, color;
    if      (points >= 200) { tier = "🏆 Gold";   color = "#d97706"; }
    else if (points >= 100) { tier = "🥈 Silver"; color = "#6b7280"; }
    else if (points >= 50)  { tier = "🥉 Bronze"; color = "#92400e"; }
    else                    { tier = "🐾 Starter"; color = "#5e4bff"; }

    tierEl.textContent  = tier;
    tierEl.style.color  = color;
}


// ── LIVE LOCATION ─────────────────────────────────────────────

// Stores the GPS watch ID so we can stop it later
let watchId = null;

// Writes a GPS position to Firestore and localStorage for the owner's map to read
function _writePosition(lat, lng, bookingId) {
    localStorage.setItem(LIVE_LOCATION_KEY, JSON.stringify({
        lat, lng, bookingId, time: Date.now()
    }));

    const firestore = getFirestoreDb();
    if (firestore) {
        firestore.collection("live_locations").doc(bookingId).set({
            lat, lng, active: true, updatedAt: new Date().toISOString()
        }).catch(err => console.error("Location sync error:", err));
    }

    updateLiveLocationStatus();
}

// Starts sharing the walker's GPS location linked to a specific booking
// Gets an immediate fix first, then watches for movement using watchPosition
function startTracking(bookingId) {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser."); return;
    }

    const geoOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };

    // Get an immediate position right now so the map shows something straight away
    navigator.geolocation.getCurrentPosition(
        position => {
            _writePosition(position.coords.latitude, position.coords.longitude, bookingId);
        },
        err => console.warn("Initial position error:", err.message),
        geoOptions
    );

    // Then keep updating as the walker moves
    watchId = navigator.geolocation.watchPosition(
        position => {
            _writePosition(position.coords.latitude, position.coords.longitude, bookingId);
        },
        err => console.warn("Watch position error:", err.message),
        geoOptions
    );
}

// Stops GPS tracking and marks the location as inactive in Firestore
function stopLiveTracking(bookingId) {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    localStorage.removeItem(LIVE_LOCATION_KEY);

    const firestore = getFirestoreDb();
    if (firestore) {
        firestore.collection("live_locations").doc(bookingId)
            .update({ active: false })
            .catch(err => console.error("Stop tracking error:", err));
    }

    updateLiveLocationStatus();
}

// Updates the status text and dot colour shown on the walker dashboard
function updateLiveLocationStatus() {
    const statusEl = document.getElementById("live-location-status");
    const dot      = document.getElementById("location-dot");
    const raw      = localStorage.getItem(LIVE_LOCATION_KEY);

    if (!raw) {
        if (statusEl) statusEl.innerHTML = "Location sharing is currently <strong>stopped</strong>.";
        if (dot) dot.classList.remove("active");
        return;
    }

    try {
        const loc = JSON.parse(raw);
        if (statusEl) {
            statusEl.innerHTML = `Location sharing is <strong>active</strong> — ` +
                `lat ${loc.lat.toFixed(5)}, lng ${loc.lng.toFixed(5)} ` +
                `at ${new Date(loc.time).toLocaleTimeString()}`;
        }
        if (dot) dot.classList.add("active");
    } catch (e) {
        if (statusEl) statusEl.textContent = "Location status unknown.";
    }
}


// ── OWNER MAP ─────────────────────────────────────────────────

// Sets up the Google Map on the owner dashboard
// Finds the owner's most recent active booking and subscribes to its live location
function initOwnerMap() {
    const mapEl = document.getElementById("map");
    if (!mapEl || typeof google === "undefined" || !google.maps) return;

    // Default to central London — moves to walker position once they share location
    const defaultPos = { lat: 51.5074, lng: -0.1278 };

    const map = new google.maps.Map(mapEl, {
        zoom: 15, center: defaultPos,
        styles: [
            { featureType: "poi",     stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] }
        ]
    });

    // Marker starts hidden — only appears when a live location comes in
    const marker = new google.maps.Marker({
        map, position: defaultPos, title: "Walker location",
        visible: false
    });

    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (!user || !user.id) return;

    const firestore = getFirestoreDb();
    if (!firestore) return;

    // Find the most recent accepted or in-progress booking for this owner
    firestore.collection("bookings")
        .where("ownerId", "==", user.id)
        .where("status", "in", ["Accepted", "InProgress"])
        .get()
        .then(snapshot => {
            if (snapshot.empty) return; // no active booking, map stays as placeholder

            const bookings = [];
            snapshot.forEach(doc => bookings.push(doc.data()));
            bookings.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
            const latest = bookings[bookings.length - 1];

            // Real-time listener — the marker moves every time the walker writes a position
            firestore.collection("live_locations").doc(latest.id)
                .onSnapshot(docSnap => {
                    if (!docSnap.exists) return;
                    const data = docSnap.data();
                    if (!data || !data.active) {
                        marker.setVisible(false);
                        return;
                    }
                    const position = { lat: data.lat, lng: data.lng };
                    marker.setPosition(position);
                    marker.setVisible(true);
                    map.setCenter(position);
                });
        })
        .catch(err => console.error("Error finding owner booking for map:", err));
}

// Initialise the map when the page finishes loading, if the map element exists
window.addEventListener("load", () => {
    if (document.getElementById("map")) initOwnerMap();
});


// ── ADMIN DASHBOARD ───────────────────────────────────────────

// Checks the user is an admin, then loads the users and bookings panels
function initAdminDashboard() {
    const user = requireRole("admin");
    if (!user) return;

    renderAdminUsers();
    renderAdminBookings();
}

// Loads all users from Firestore for the admin users panel
// Filters out admin accounts so only owners and walkers are shown
function renderAdminUsers() {
    const roleFilter = document.getElementById("admin-role-filter");
    const list       = document.getElementById("admin-users-list");
    const countEl    = document.getElementById("user-count");
    if (!roleFilter || !list) return;

    const filterValue = roleFilter.value || "all";
    const firestore   = getFirestoreDb();

    if (firestore) {
        firestore.collection("users").get()
            .then(snapshot => {
                const users = [];
                snapshot.forEach(doc => {
                    const u = doc.data();
                    // Skip admin accounts — admin shouldn't see themselves listed
                    if (u.role !== "admin") users.push(u);
                });

                const filtered = filterValue === "all"
                    ? users
                    : users.filter(u => u.role === filterValue);

                displayAdminUsers(list, filtered, countEl);
            })
            .catch(err => {
                console.error("Firestore users error:", err);
                const users    = getUsers().filter(u => u.role !== "admin");
                const filtered = filterValue === "all"
                    ? users : users.filter(u => u.role === filterValue);
                displayAdminUsers(list, filtered, countEl);
            });
    } else {
        const users    = getUsers().filter(u => u.role !== "admin");
        const filtered = filterValue === "all"
            ? users : users.filter(u => u.role === filterValue);
        displayAdminUsers(list, filtered, countEl);
    }
}

// Builds the HTML for each user card in the admin panel
function displayAdminUsers(list, filtered, countEl) {
    if (countEl) countEl.textContent = filtered.length + " user" + (filtered.length !== 1 ? "s" : "");

    list.innerHTML = "";

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div>No users match this filter.</div>';
        return;
    }

    filtered.forEach(u => {
        // Get initials from name for the avatar circle
        const initials = (u.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        const status   = u.accountStatus || "active";

        // Pick a colour for the status label
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        const statusColor = status === "active"  ? "#16a34a"
                          : status === "paused"  ? "#d97706"
                          : status === "blocked" ? "#dc2626"
                          : "#6b7280";

        const item     = document.createElement("div");
        item.className = "user-item";
        item.innerHTML = `
            <div class="user-avatar">${initials}</div>
            <div class="user-item-info">
                <strong>${u.name || "Unknown"}</strong>
                <span>${u.email}</span>
                <span style="font-size:0.75rem;font-weight:600;color:${statusColor};">
                    ● ${statusLabel}
                </span>
            </div>
            <span class="role-badge role-${u.role}">${u.role}</span>
            <div class="admin-user-actions">
                ${status !== "active"  ? `<button class="admin-btn admin-btn-activate" onclick="adminSetUserStatus('${u.id}', 'active')">Activate</button>` : ""}
                ${status !== "blocked" ? `<button class="admin-btn admin-btn-block"    onclick="adminSetUserStatus('${u.id}', 'blocked')">Block</button>` : ""}
                <button class="admin-btn admin-btn-delete" onclick="adminDeleteUser('${u.id}', '${u.email}', '${(u.name || "").replace(/'/g, "\\'")}')">Delete</button>
            </div>
        `;
        list.appendChild(item);
    });
}

// Loads all bookings from Firestore for the admin bookings panel
function renderAdminBookings() {
    const statusFilter = document.getElementById("admin-status-filter");
    const list         = document.getElementById("admin-bookings-list");
    const countEl      = document.getElementById("booking-count");
    if (!statusFilter || !list) return;

    const filterValue = statusFilter.value || "all";
    const firestore   = getFirestoreDb();

    if (firestore) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div>Loading bookings...</div>';

        firestore.collection("bookings").get()
            .then(snapshot => {
                const bookings = [];
                snapshot.forEach(doc => bookings.push(doc.data()));
                displayAdminBookings(list, bookings, filterValue, countEl);
            })
            .catch(err => {
                console.error("Firestore error:", err);
                displayAdminBookings(list, getBookings(), filterValue, countEl);
            });
    } else {
        displayAdminBookings(list, getBookings(), filterValue, countEl);
    }
}

// Filters and builds the HTML for each booking card in the admin panel
function displayAdminBookings(list, bookings, filterValue, countEl) {
    const filtered = bookings.filter(b =>
        filterValue === "all" ? true : b.status === filterValue
    );

    if (countEl) countEl.textContent = filtered.length + " booking" + (filtered.length !== 1 ? "s" : "");
    list.innerHTML = "";

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div>No bookings match this filter.</div>';
        return;
    }

    // Show newest bookings first
    filtered.sort((a, b) =>
        (b.createdAt || "").toString().localeCompare((a.createdAt || "").toString())
    );

    filtered.forEach(b => {
        // Pick the right badge colour for this booking's status
        const cls = {
            "Pending":    "badge-pending",
            "Accepted":   "badge-accepted",
            "Completed":  "badge-completed",
            "Declined":   "badge-declined",
            "InProgress": "badge-inprogress"
        }[b.status] || "badge-pending";

        const item     = document.createElement("div");
        item.className = "booking-item";
        item.innerHTML = `
            <div class="booking-item-header">
                <strong>${b.service || "Dog Walk"}</strong>
                <span class="badge ${cls}">${b.status}</span>
            </div>
            <p>📅 ${b.date || "—"} at ${b.time || "—"}</p>
            <p>👤 Owner: ${b.ownerName  || "Unknown"}</p>
            <p>🦮 Walker: ${b.walkerName || "Unassigned"}</p>
        `;
        list.appendChild(item);
    });
}

// Fills the four stat cards at the top of the admin dashboard with live counts
function fillStatCards() {
    const firestore = getFirestoreDb();

    if (firestore) {
        // Count owners and walkers from Firestore
        firestore.collection("users").get().then(snapshot => {
            let owners = 0, walkers = 0;
            snapshot.forEach(doc => {
                const u = doc.data();
                if (u.role === "owner")  owners++;
                if (u.role === "walker") walkers++;
            });
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set("stat-total-users", owners + walkers);
            set("stat-owners",  owners);
            set("stat-walkers", walkers);
        }).catch(err => console.error("Stat users error:", err));

        // Count bookings separately
        firestore.collection("bookings").get().then(snapshot => {
            const el = document.getElementById("stat-bookings");
            if (el) el.textContent = snapshot.size;
        }).catch(err => console.error("Stat bookings error:", err));

    } else {
        // Fallback to localStorage
        const users = getUsers().filter(u => u.role !== "admin");
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("stat-total-users", users.length);
        set("stat-owners",  users.filter(u => u.role === "owner").length);
        set("stat-walkers", users.filter(u => u.role === "walker").length);
        set("stat-bookings", getBookings().length);
    }
}

// Finds the walker's most recent accepted booking and starts GPS tracking for it
function startTrackingForWalker() {
    const user = requireRole("walker");
    if (!user) return;

    const firestore = getFirestoreDb();
    if (!firestore) {
        alert("Firebase not available."); return;
    }

    firestore.collection("bookings")
        .where("walkerId", "==", user.id)
        .where("status", "==", "Accepted")
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                alert("No accepted booking found. You need an accepted booking to share your location.");
                return;
            }

            const bookings = [];
            snapshot.forEach(doc => bookings.push(doc.data()));
            // Use the most recent accepted booking
            bookings.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
            const latest = bookings[bookings.length - 1];

            // Store the booking ID so stopTrackingForWalker can find it
            localStorage.setItem("activeBookingId", latest.id);

            startTracking(latest.id);
            alert("Location sharing started for booking on " + latest.date + " at " + latest.time);
        })
        .catch(err => {
            console.error("Error finding booking:", err);
            alert("Could not start tracking: " + err.message);
        });
}

// Stops GPS tracking using the booking ID saved when tracking started
function stopTrackingForWalker() {
    const bookingId = localStorage.getItem("activeBookingId");
    if (!bookingId) {
        alert("No active tracking session found.");
        return;
    }
    stopLiveTracking(bookingId);
    localStorage.removeItem("activeBookingId");
}


// ── ADMIN: ACCOUNT MANAGEMENT ────────────────────────────────
// These functions let the admin block, activate or delete user accounts

// Updates a user's accountStatus to "active", "paused" or "blocked" in Firestore
function adminSetUserStatus(userId, newStatus) {
    const label = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

    if (!confirm(`Are you sure you want to set this account to "${label}"?`)) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("users").doc(userId).update({ accountStatus: newStatus })
            .then(() => {
                // Also update localStorage cache to keep the UI in sync
                const users = getUsers();
                const idx   = users.findIndex(u => u.id === userId);
                if (idx >= 0) {
                    users[idx].accountStatus = newStatus;
                    saveUsers(users);
                }
                alert(`Account ${label.toLowerCase()}d successfully.`);
                renderAdminUsers();
            })
            .catch(err => {
                console.error("Status update error:", err);
                alert("Failed to update account status: " + err.message);
            });
    } else {
        // Fallback: localStorage only
        const users = getUsers();
        const idx   = users.findIndex(u => u.id === userId);
        if (idx >= 0) {
            users[idx].accountStatus = newStatus;
            saveUsers(users);
            alert(`Account ${label.toLowerCase()}d successfully.`);
            renderAdminUsers();
        } else {
            alert("User not found in local storage.");
        }
    }
}

// Permanently deletes a user's Firestore document and removes them from the local cache
// Note: deleting the Firebase Auth account requires the Admin SDK (server-side)
// For this prototype, the Firestore doc is removed and the account becomes inaccessible
function adminDeleteUser(userId, email, name) {
    if (!confirm(`Permanently delete the account for "${name}" (${email})?\n\nThis cannot be undone.`)) return;

    const firestore = getFirestoreDb();

    if (firestore) {
        firestore.collection("users").doc(userId).delete()
            .then(() => {
                // Remove from localStorage cache too
                const users    = getUsers();
                const filtered = users.filter(u => u.id !== userId);
                saveUsers(filtered);

                alert(`Account for "${name}" has been deleted.`);
                renderAdminUsers();
                fillStatCards();
            })
            .catch(err => {
                console.error("Delete user error:", err);
                alert("Failed to delete account: " + err.message);
            });
    } else {
        // Fallback: localStorage only
        const users    = getUsers();
        const filtered = users.filter(u => u.id !== userId);
        saveUsers(filtered);
        alert(`Account for "${name}" has been deleted.`);
        renderAdminUsers();
        fillStatCards();
    }
}


// ── SELF: DELETE OWN ACCOUNT ──────────────────────────────────
// Called from the My Account dropdown on the owner and walker dashboards

function deleteOwnAccount() {
    const raw = localStorage.getItem("currentUser");
    if (!raw) {
        alert("You are not logged in.");
        window.location.href = "index.html";
        return;
    }

    let user;
    try { user = JSON.parse(raw); }
    catch (e) {
        alert("Session error. Please log in again.");
        window.location.href = "index.html";
        return;
    }

    if (!confirm(
        "Are you sure you want to permanently delete your account?\n\n" +
        "All your data will be removed. This cannot be undone."
    )) return;

    const firestore    = getFirestoreDb();
    const firebaseAuth = getAuth();

    // Step 1: Delete the Firestore profile document
    const deleteFirestoreDoc = firestore
        ? firestore.collection("users").doc(user.id).delete()
        : Promise.resolve();

    deleteFirestoreDoc
        .then(() => {
            // Step 2: Remove from localStorage user cache
            const users    = getUsers();
            const filtered = users.filter(u => u.id !== user.id);
            saveUsers(filtered);

            // Step 3: Clear the current session from localStorage
            localStorage.removeItem("currentUser");
            localStorage.removeItem("activeBookingId");
            localStorage.removeItem(LIVE_LOCATION_KEY);

            // Step 4: Delete the Firebase Auth account
            // This only works because the user is currently signed in
            if (firebaseAuth && firebaseAuth.currentUser) {
                return firebaseAuth.currentUser.delete();
            }
            return Promise.resolve();
        })
        .then(() => {
            alert("Your account has been permanently deleted.");
            window.location.href = "index.html";
        })
        .catch(err => {
            console.error("Delete own account error:", err);

            // Firebase requires a recent login to delete an Auth account
            // If this error occurs, guide the user to log back in first
            if (err.code === "auth/requires-recent-login") {
                alert(
                    "For security, please log out and log back in, " +
                    "then try deleting your account again."
                );
            } else {
                alert("Failed to delete account: " + err.message);
            }
        });
}
