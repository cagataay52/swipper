/* Swipper — Firebase-backed social feed */
const firebaseConfig = {
  apiKey: "AIzaSyCTbvB4-LBG-jP8zNkJhLNEaQfQpTAdEjA",
  authDomain: "swipper-2f2a4.firebaseapp.com",
  projectId: "swipper-2f2a4",
  storageBucket: "swipper-2f2a4.firebasestorage.app",
  messagingSenderId: "1025977111228",
  appId: "1:1025977111228:web:f2b0013a21c5f2b434b6b9"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const fieldValue = firebase.firestore.FieldValue;

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null, users: {}, posts: [], stories: [], feed: "all",
    activeCommentPostId: null, activeChatUserId: null, selectedMedia: null,
    selectedStory: null, sharePostId: null, chatUnsubscribe: null,
    commentUnsubscribe: null, unsubscribers: [], postListenerStarted: false
  };

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  // MOBİL NATIVE HİS: Titreşim (Haptic Feedback)
  const triggerHaptic = (type = "light") => {
    if (!navigator.vibrate) return;
    if (type === "light") navigator.vibrate(40);
    if (type === "success") navigator.vibrate([30, 50, 30]);
  };

  // MOBİL NATIVE HİS: Uygulama İçi Bildirim (Toast)
  const showToast = (message, icon = "fa-bell") => {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = "app-toast";
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);
    
    // Animasyon tetikleme
    setTimeout(() => toast.classList.add("is-visible"), 10);
    
    // Temizleme
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });

  const escapeHTML = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const cleanHandle = (value = "") => String(value).trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  const avatarFor = (profile = {}) => {
    const candidate = String(profile.avatar || "");
    if (/^https?:\/\//i.test(candidate)) return candidate;
    return `https://api.dicebear.com/9.x/initials/svg?backgroundColor=eceaff&fontFamily=Arial&seed=${encodeURIComponent(profile.username || profile.name || "swipper")}`;
  };
  const safeMediaURL = (value) => /^https?:\/\//i.test(String(value || "")) ? String(value) : "";
  const dateFrom = (value) => value && typeof value.toDate === "function" ? value.toDate() : null;
  const formatDate = (value) => {
    const date = dateFrom(value);
    if (!date) return "şimdi";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "şimdi";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} g`;
    return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  };
  const chatIdFor = (first, second) => [first, second].sort().join("_");
  const currentProfile = () => state.users[state.user?.uid] || {};
  const postText = (post) => String(post.text ?? post.caption ?? "");
  const postMedia = (post) => safeMediaURL(post.mediaUrl || post.imageUrl || post.videoUrl);
  const isVideo = (post) => post.mediaType === "video" || /\.(mp4|webm|mov)(?:\?|$)/i.test(postMedia(post));

  function setSplashGone() { setTimeout(() => $("splash-screen").classList.add("is-gone"), 450); }
  function showAuthError(message) { $("auth-error").textContent = message; triggerHaptic(); }
  function firebaseError(error, fallback) {
    const copy = { "auth/invalid-email": "Geçerli bir e-posta adresi yaz.", "auth/user-not-found": "Bu bilgilerle bir hesap bulunamadı.", "auth/wrong-password": "Şifren doğru görünmüyor.", "auth/email-already-in-use": "Bu e-posta ile zaten bir hesap var." };
    return copy[error?.code] || fallback || "Bir şey ters gitti. Lütfen tekrar dene.";
  }

  function openModal(id) {
    triggerHaptic();
    document.querySelectorAll(".modal").forEach((modal) => modal.hidden = true);
    $("modal-layer").hidden = false;
    $(id).hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModals() {
    document.querySelectorAll(".modal").forEach((modal) => modal.hidden = true);
    $("modal-layer").hidden = true;
    document.body.style.overflow = "";
    if (state.commentUnsubscribe) { state.commentUnsubscribe(); state.commentUnsubscribe = null; }
  }

  function updateThemeButton() {
    const dark = document.body.classList.contains("is-dark");
    $("theme-toggle").querySelector("i").className = dark ? "fa-solid fa-sun" : "fa-regular fa-moon";
    $("theme-toggle").querySelector("span").textContent = dark ? "Açık tema" : "Tema";
    // Tarayıcı üst çubuğu rengini ayarla (OLED Siyah veya Saf Beyaz)
    const metaThemeColor = document.getElementById("theme-color-meta");
    if(metaThemeColor) metaThemeColor.setAttribute("content", dark ? "#000000" : "#ffffff");
  }

  function restoreTheme() {
    const saved = localStorage.getItem("swipper-theme");
    if (saved === "dark" || (!saved && prefersDark.matches)) document.body.classList.add("is-dark");
    else document.body.classList.remove("is-dark");
    updateThemeButton();
  }

  prefersDark.addEventListener("change", (e) => {
    if (!localStorage.getItem("swipper-theme")) { document.body.classList.toggle("is-dark", e.matches); updateThemeButton(); }
  });

  function setProfileSurfaces() {
    const profile = currentProfile();
    if (!state.user || !profile.username) return;
    const avatar = avatarFor(profile);
    [["side-user-avatar", avatar], ["quick-avatar", avatar], ["composer-avatar", avatar], ["bottom-avatar", avatar]].forEach(([id, src]) => { $(id).src = src; $(id).alt = profile.name \vert{}\vert{} profile.username; });$("side-user-name").textContent = profile.name || profile.username;
    $("side-user-handle").textContent = `@${profile.username}`;
    $("composer-name").textContent = profile.name || profile.username;
    $("composer-handle").textContent = `@${profile.username}`;
  }

  function showView(view) {
    triggerHaptic();
    document.querySelectorAll(".view").forEach((item) => item.classList.toggle("is-active", item.id === `view-${view}`));
    document.querySelectorAll(".nav-link[data-view]").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
    if (view === "profile") renderProfile();
    if (view === "explore") renderExplore();
    if (view === "messages") renderConversationList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderStories() {
    const root = $("stories");
    const profile = currentProfile();
    const stories = [`<button class="story story--add" type="button" data-story-action="add"><span class="story-ring"><img src="${escapeHTML(avatarFor(profile))}" alt=""></span><span>Hikayen</span></button>`];
    state.stories.slice(0, 15).forEach((story) => {
      const user = state.users[story.authorId] || { username: "swipper" };
      stories.push(`<button class="story" type="button" data-story-id="${escapeHTML(story.id)}"><span class="story-ring"><img src="${escapeHTML(avatarFor(user))}" alt="${escapeHTML(user.username)}"></span><span>${escapeHTML(user.username || "üye")}</span></button>`);
    });
    root.innerHTML = stories.join("");
  }

  function postMarkup(post) {
    const author = state.users[post.authorId] || { username: "swipper", name: "Swipper üyesi" };
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const liked = likes.includes(state.user?.uid);
    const content = postText(post);
    const media = postMedia(post);
    const visual = !media ? "" : isVideo(post) ? `<div class="post-media"><video src="${escapeHTML(media)}" controls playsinline preload="metadata"></video></div>` : `<div class="post-media"><img src="${escapeHTML(media)}" alt="Paylaşım" loading="lazy"></div>`;
    
    return `<article class="post-card" data-post-id="${escapeHTML(post.id)}">
      <div class="post-main">
        <header class="post-head">
          <button type="button" data-user-id="${escapeHTML(post.authorId)}"><img src="${escapeHTML(avatarFor(author))}" alt=""></button>
          <button class="post-author" type="button" data-user-id="${escapeHTML(post.authorId)}"><b>${escapeHTML(author.name || author.username)}</b><span>@${escapeHTML(author.username)} · ${formatDate(post.createdAt)}</span></button>
          ${post.authorId === state.user?.uid ? `<button class="post-more" type="button" data-post-action="delete"><i class="fa-solid fa-trash-can"></i></button>` : ""}
        </header>
        ${content ? `<p class="post-text">${escapeHTML(content)}</p>` : ""}
        ${visual}
        <footer class="post-actions">
          <button class="reaction-button ${liked ? "is-liked" : ""}" type="button" data-post-action="like"><i class="${liked ? "fa-solid" : "fa-regular"} fa-heart"></i><span>${likes.length || ""}</span></button>
          <button class="reaction-button" type="button" data-post-action="comments"><i class="fa-regular fa-comment"></i><span>${Number(post.commentsCount || 0) || ""}</span></button>
          <button class="reaction-button reaction-button--share" type="button" data-post-action="share"><i class="fa-regular fa-paper-plane"></i></button>
        </footer>
      </div>
    </article>`;
  }

  function renderFeed() {
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const posts = state.feed === "following" ? state.posts.filter((post) => following.includes(post.authorId)) : state.posts;
    $("feed").innerHTML = posts.map(postMarkup).join("");
    $("empty-feed").hidden = posts.length > 0;
    document.querySelectorAll(".feed-tab").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.feed === state.feed));
  }

  function renderExplore() {
    const query = $("user-search").value.trim().toLocaleLowerCase("tr-TR");
    $("clear-search").hidden = !query;
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const photoPosts = state.posts.filter((post) => postMedia(post)).slice(0, 24);
    $("explore-gallery").innerHTML = photoPosts.length ? photoPosts.map((post) => {
      const media = postMedia(post);
      const likes = Array.isArray(post.likes) ? post.likes.length : 0;
      const visual = isVideo(post) ? `<video src="${escapeHTML(media)}" muted playsinline></video>` : `<img src="${escapeHTML(media)}" alt="" loading="lazy">`;
      return `<button class="explore-tile" type="button" data-open-post="${escapeHTML(post.id)}">${visual}<span class="explore-tile-badge"><i class="${isVideo(post) ? "fa-solid fa-play" : "fa-regular fa-heart"}"></i>${likes || ""}</span></button>`;
    }).join("") : "";
    
    const people = Object.entries(state.users).filter(([uid, person]) => uid !== state.user?.uid && `${person.name || ""} ${person.username || ""}`.toLocaleLowerCase("tr-TR").includes(query)).sort(([, a], [, b]) => String(a.username || "").localeCompare(String(b.username || ""), "tr"));
    $("explore-users").innerHTML = people.length ? people.map(([uid, person]) => `<article class="user-card"><button class="user-card-top" type="button" data-user-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span class="user-card-info"><b>${escapeHTML(person.name || person.username)}</b><span>@${escapeHTML(person.username)}</span></span></button><button class="button ${following.includes(uid) ? "button--soft" : "button--primary"}" type="button" data-follow-id="${escapeHTML(uid)}">${following.includes(uid) ? "Takipte" : "Takip et"}</button></article>`).join("") : `<div class="empty-state"><h3>Kimse bulunamadı</h3></div>`;
  }

  function profileMarkup(profile, uid, isOwn) {
    const posts = state.posts.filter((post) => post.authorId === uid);
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const isFollowing = following.includes(uid);
    const grid = posts.length ? posts.map((post) => {
      const media = postMedia(post);
      if (media) return `<button class="profile-grid-item" type="button" data-open-post="${escapeHTML(post.id)}">${isVideo(post) ? `<video src="${escapeHTML(media)}" muted preload="metadata"></video>` : `<img src="${escapeHTML(media)}" alt="">`}</button>`;
      return `<button class="profile-grid-item profile-text-post" type="button" data-open-post="${escapeHTML(post.id)}">${escapeHTML(postText(post).slice(0, 70))}</button>`;
    }).join("") : `<div class="empty-state"><p>Henüz paylaşım yok</p></div>`;
    
    return `<div class="profile-hero"><div class="profile-hero-top"><img class="profile-avatar" src="${escapeHTML(avatarFor(profile))}" alt=""><div class="profile-head-copy"><h2>${escapeHTML(profile.name || profile.username)}</h2><span>@${escapeHTML(profile.username)}</span></div></div>
      <p class="profile-bio">${escapeHTML(profile.bio || "Swipper'da yeni fikirler keşfediyor.")}</p>
      <div class="profile-actions">${isOwn ? `<button id="edit-profile" class="button button--soft" type="button">Profili düzenle</button>` : `<button class="button ${isFollowing ? "button--soft" : "button--primary"}" type="button" data-follow-id="${escapeHTML(uid)}">${isFollowing ? "Takipte" : "Takip et"}</button><button class="button button--soft" type="button" data-message-id="${escapeHTML(uid)}">Mesaj</button>`}</div>
      <div class="profile-stats">
        <span class="profile-stat"><b>${posts.length}</b><span>Gönderi</span></span>
        <button class="profile-stat profile-stat--click" type="button" data-network-action="followers" data-network-uid="${escapeHTML(uid)}"><b>${Array.isArray(profile.followers) ? profile.followers.length : 0}</b><span>Takipçi</span></button>
        <button class="profile-stat profile-stat--click" type="button" data-network-action="following" data-network-uid="${escapeHTML(uid)}"><b>${Array.isArray(profile.following) ? profile.following.length : 0}</b><span>Takip</span></button>
      </div></div>
      <div class="profile-grid">${grid}</div>`;
  }

  function renderProfile() { if (state.user) $("profile-content").innerHTML = profileMarkup(currentProfile(), state.user.uid, true); }
  function openUserProfile(uid) {
    if (!state.users[uid]) return;
    $("user-modal-content").innerHTML = `<div class="user-profile">${profileMarkup(state.users[uid], uid, uid === state.user?.uid)}</div>`;
    openModal("user-modal");
  }

  function openNetworkModal(type, uid) {
    const profile = state.users[uid];
    if (!profile) return;
    const list = type === "followers" ? profile.followers : profile.following;
    const uids = Array.isArray(list) ? list : [];
    $("network-modal-title").textContent = type === "followers" ? "Takipçiler" : "Takip Edilenler";
    const myFollowing = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    $("network-list").innerHTML = uids.length ? uids.map(id => {
      const person = state.users[id];
      if (!person) return "";
      const isFollowing = myFollowing.includes(id);
      return `<div class="network-item"><button type="button" class="network-item-info" data-user-id="${escapeHTML(id)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><div><b>${escapeHTML(person.name || person.username)}</b><span>@${escapeHTML(person.username)}</span></div></button>${id !== state.user?.uid ? `<button class="button ${isFollowing ? "button--soft" : "button--primary"}" type="button" data-follow-id="${escapeHTML(id)}">${isFollowing ? "Takipte" : "Takip et"}</button>` : ""}</div>`;
    }).join("") : `<div class="empty-state"><p>Burada henüz kimse yok.</p></div>`;
    openModal("network-modal");
  }

  function openPostDetail(id) {
    const post = state.posts.find((item) => item.id === id);
    if (!post) return;
    $("post-modal-content").innerHTML = postMarkup(post);
    openModal("post-modal");
  }

  function renderConversationList() {
    const people = Object.entries(state.users).filter(([uid]) => uid !== state.user?.uid).sort(([, a], [, b]) => String(a.name || "").localeCompare(String(b.name || ""), "tr"));
    $("conversation-list").innerHTML = people.length ? people.map(([uid, person]) => `<button class="conversation-item ${state.activeChatUserId === uid ? "is-active" : ""}" type="button" data-message-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span class="conversation-copy"><b>${escapeHTML(person.name || person.username)}</b><span>Sohbet et</span></span></button>`).join("") : "";
  }

  function renderMessageUsers() {
    const people = Object.entries(state.users).filter(([uid]) => uid !== state.user?.uid);
    $("message-user-list").innerHTML = people.length ? people.map(([uid, person]) => `<button class="message-user" type="button" data-message-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span><b>${escapeHTML(person.name || person.username)}</b><small>@${escapeHTML(person.username)}</small></span></button>`).join("") : "";
  }

  function openChat(uid) {
    const person = state.users[uid];
    if (!person || !state.user) return;
    closeModals();
    state.activeChatUserId = uid;
    $("chat-user-avatar").src = avatarFor(person);
    $("chat-user-name").textContent = person.name || person.username;
    $("chat-pane").closest(".messages-layout").classList.add("is-chat-open");
    showView("messages");
    if (state.chatUnsubscribe) state.chatUnsubscribe();
    state.chatUnsubscribe = db.collection("chats").doc(chatIdFor(state.user.uid, uid)).collection("messages").orderBy("createdAt", "asc").onSnapshot((snapshot) => {
      $("chat-messages").innerHTML = snapshot.docs.map((doc) => {
        const message = doc.data();
        return `<div class="message ${message.senderId === state.user.uid ? "message--mine" : "message--theirs"}">${escapeHTML(message.text || "")}</div>`;
      }).join("");
      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    });
  }

  async function toggleFollow(uid) {
    if (!state.user || uid === state.user.uid) return;
    triggerHaptic();
    const followed = (Array.isArray(currentProfile().following) ? currentProfile().following : []).includes(uid);
    try {
      await Promise.all([
        db.collection("users").doc(state.user.uid).update({ following: followed ? fieldValue.arrayRemove(uid) : fieldValue.arrayUnion(uid) }),
        db.collection("users").doc(uid).update({ followers: followed ? fieldValue.arrayRemove(state.user.uid) : fieldValue.arrayUnion(state.user.uid) })
      ]);
      showToast(followed ? "Takipten çıkıldı" : "Takip edildi", followed ? "fa-user-minus" : "fa-user-check");
      if (!$("network-modal").hidden) setTimeout(() => openNetworkModal($("network-modal-title").textContent === "Takipçiler" ? "followers" : "following", $("user-modal").hidden ? state.user.uid : uid), 100);
    } catch (error) { alert(firebaseError(error)); }
  }

  function openComposer() {
    state.selectedMedia = null;
    $("media-input").value = ""; $("media-preview").hidden = true; $("media-preview").innerHTML = ""; $("post-text").value = ""; $("upload-status").textContent = "";
    openModal("composer-modal");
  }

  async function uploadMedia(file, msgElement) {
    if (file.size > 50 * 1024 * 1024) throw new Error("Dosya çok büyük.");
    msgElement.textContent = "Medya yükleniyor...";
    const fd = new FormData(); fd.append("reqtype", "fileupload"); fd.append("fileToUpload", file);
    const res = await fetch("https://corsproxy.io/?https://catbox.moe/user/api.php", { method: "POST", body: fd });
    if (!res.ok) throw new Error("Yükleme başarısız.");
    return (await res.text()).trim();
  }

  async function publishPost(event) {
    event.preventDefault();
    const text = $("post-text").value.trim();
    if (!text && !state.selectedMedia) return;
    $("publish-btn").disabled = true;
    try {
      let mediaUrl = "";
      if (state.selectedMedia) mediaUrl = await uploadMedia(state.selectedMedia, $("upload-status"));
      await db.collection("posts").add({ authorId: state.user.uid, text, caption: text, mediaUrl, imageUrl: mediaUrl, mediaType: state.selectedMedia?.type.startsWith("video/") ? "video" : state.selectedMedia ? "image" : "", likes: [], commentsCount: 0, createdAt: fieldValue.serverTimestamp() });
      closeModals();
      showToast("Başarıyla paylaşıldı!", "fa-circle-check");
      triggerHaptic("success");
    } catch (error) { $("upload-status").textContent = error.message; }
    finally { $("publish-btn").disabled = false; }
  }

  async function likePost(id) {
    if (!state.user) return;
    triggerHaptic();
    const ref = db.collection("posts").doc(id);
    try {
      await db.runTransaction(async (t) => {
        const doc = await t.get(ref);
        if (!doc.exists) return;
        const likes = Array.isArray(doc.data().likes) ? doc.data().likes : [];
        t.update(ref, { likes: likes.includes(state.user.uid) ? likes.filter(i => i !== state.user.uid) : [...likes, state.user.uid] });
      });
    } catch (e) { console.error(e); }
  }

  async function deletePost(id) {
    if (!window.confirm("Bu paylaşım silinsin mi?")) return;
    try { await db.collection("posts").doc(id).delete(); showToast("Paylaşım silindi", "fa-trash"); }
    catch (error) { alert("Silinemedi."); }
  }

  function openComments(id) {
    state.activeCommentPostId = id; $("comments-list").innerHTML = ""; $("comment-input").value = "";
    openModal("comments-modal");
    if (state.commentUnsubscribe) state.commentUnsubscribe();
    state.commentUnsubscribe = db.collection("posts").doc(id).collection("comments").orderBy("createdAt", "asc").onSnapshot((snapshot) => {
      $("comments-list").innerHTML = snapshot.docs.length ? snapshot.docs.map(doc => {
        const c = doc.data(); const author = state.users[c.authorId] || { username: "üye" };
        return `<article class="comment"><img class="comment-avatar" src="${escapeHTML(avatarFor(author))}" alt=""><div class="comment-body"><b>@${escapeHTML(author.username)}</b><p>${escapeHTML(c.text)}</p></div></article>`;
      }).join("") : `<p>İlk yorumu sen bırak.</p>`;
      $("comments-list").scrollTop = $("comments-list").scrollHeight;
    });
  }

  async function sendComment(event) {
    event.preventDefault();
    const text = $("comment-input").value.trim();
    if (!text || !state.activeCommentPostId) return;
    try {
      await db.collection("posts").doc(state.activeCommentPostId).collection("comments").add({ authorId: state.user.uid, text, createdAt: fieldValue.serverTimestamp() });
      await db.collection("posts").doc(state.activeCommentPostId).update({ commentsCount: fieldValue.increment(1) });
      $("comment-input").value = "";
      triggerHaptic("success");
    } catch (e) { alert("Gönderilemedi."); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = $("chat-input").value.trim();
    if (!text || !state.activeChatUserId || !state.user) return;
    try {
      await db.collection("chats").doc(chatIdFor(state.user.uid, state.activeChatUserId)).collection("messages").add({ senderId: state.user.uid, text, createdAt: fieldValue.serverTimestamp() });
      $("chat-input").value = ""; triggerHaptic();
    } catch (e) { alert("Mesaj gönderilemedi."); }
  }

  async function sharePostTo(uid) {
    const post = state.posts.find(i => i.id === state.sharePostId);
    if (!post || !state.user) return openChat(uid);
    try {
      await db.collection("chats").doc(chatIdFor(state.user.uid, uid)).collection("messages").add({ senderId: state.user.uid, text: `↗ Paylaşım: ${postText(post).slice(0, 50)}...`, createdAt: fieldValue.serverTimestamp() });
      state.sharePostId = null; openChat(uid); showToast("Sohbete gönderildi", "fa-paper-plane");
    } catch (e) { alert("Gönderilemedi."); }
  }

  function openStory(id) {
    const story = state.stories.find(i => i.id === id);
    if (!story) return;
    const author = state.users[story.authorId] || { username: "swipper" };
    $("story-content").innerHTML = `<div class="story-view"><img src="${escapeHTML(safeMediaURL(story.imageUrl))}" alt=""><div class="story-copy"><img src="${escapeHTML(avatarFor(author))}" alt=""><span><b>${escapeHTML(author.name || author.username)}</b></span></div></div>`;
    openModal("story-modal");
  }

  async function saveProfile(event) {
    event.preventDefault();
    const name = $("profile-name-input").value.trim();
    const username = cleanHandle($("profile-handle-input").value);
    if (!name || username.length < 3) return $("profile-error").textContent = "Ad ve (min 3) kullanıcı adı yaz.";
    if (Object.entries(state.users).find(([uid, p]) => uid !== state.user.uid && cleanHandle(p.username) === username)) return $("profile-error").textContent = "Bu kullanıcı adı alınmış.";
    try { 
      await db.collection("users").doc(state.user.uid).update({ name, username, bio: $("profile-bio-input").value.trim() }); 
      closeModals(); showToast("Profil kaydedildi", "fa-user-pen"); triggerHaptic("success");
    } catch (e) { $("profile-error").textContent = "Kaydedilemedi."; }
  }

  function startRealtimeData() {
    state.unsubscribers.forEach(u => u()); state.unsubscribers = [];
    state.unsubscribers.push(db.collection("users").onSnapshot(s => { state.users = {}; s.forEach(d => state.users[d.id] = d.data()); setProfileSurfaces(); renderStories(); renderFeed(); renderExplore(); renderProfile(); renderConversationList(); renderMessageUsers(); }));
    state.unsubscribers.push(db.collection("posts").orderBy("createdAt", "desc").onSnapshot(s => { state.posts = s.docs.map(d => ({ id: d.id, ...d.data() })); renderFeed(); renderProfile(); }));
    state.unsubscribers.push(db.collection("stories").orderBy("createdAt", "desc").limit(20).onSnapshot(s => { const cutoff = Date.now() - 24 * 60 * 60 * 1000; state.stories = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(story => !dateFrom(story.createdAt) || dateFrom(story.createdAt).getTime() > cutoff); renderStories(); }));
  }

  function shutdownRealtimeData() {
    state.unsubscribers.forEach(u => u()); state.unsubscribers = [];
    if (state.chatUnsubscribe) state.chatUnsubscribe(); if (state.commentUnsubscribe) state.commentUnsubscribe();
  }

  $("auth-form").addEventListener("submit", async (e) => { e.preventDefault(); try { await auth.signInWithEmailAndPassword($("auth-email").value.trim(), $("auth-password").value); } catch (er) { showAuthError(firebaseError(er)); } });
  $("register-btn").addEventListener("click", async () => { try { await auth.createUserWithEmailAndPassword($("auth-email").value.trim(), $("auth-password").value); } catch (er) { showAuthError(firebaseError(er)); } });
  $("logout-btn").addEventListener("click", () => auth.signOut());
  
  $("theme-toggle").addEventListener("click", () => { document.body.classList.toggle("is-dark"); localStorage.setItem("swipper-theme", document.body.classList.contains("is-dark") ? "dark" : "light"); updateThemeButton(); triggerHaptic(); });
  
  document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
  [$("open-composer"), $("open-composer-side"), $("mobile-compose"), $("bottom-compose")].forEach(btn => btn.addEventListener("click", openComposer));
  $("refresh-feed").addEventListener("click", () => { triggerHaptic(); renderFeed(); $("refresh-feed").querySelector("i").classList.add("fa-spin"); setTimeout(() => $("refresh-feed").querySelector("i").classList.remove("fa-spin"), 400); showToast("Akış güncellendi", "fa-rotate-right"); });
  $("user-search").addEventListener("input", renderExplore);
  $("clear-search").addEventListener("click", () => { $("user-search").value = ""; renderExplore(); $("user-search").focus(); });
  document.querySelectorAll(".feed-tab").forEach(btn => btn.addEventListener("click", () => { triggerHaptic(); state.feed = btn.dataset.feed; renderFeed(); }));
  
  $("composer-form").addEventListener("submit", publishPost);
  $("media-input").addEventListener("change", (e) => { const f = e.target.files[0]; if (!f) return; state.selectedMedia = f; const u = URL.createObjectURL(f); const p = $("media-preview"); p.innerHTML = `${f.type.startsWith("video/") ? `<video src="${u}" controls playsinline></video>` : `<img src="${u}" alt="">`}<button id="remove-media" type="button"><i class="fa-solid fa-xmark"></i></button>`; p.hidden = false; $("remove-media").onclick = () => { URL.revokeObjectURL(u); state.selectedMedia = null; $("media-input").value = ""; p.hidden = true; }; });
  $("story-input").addEventListener("change", async (e) => { const f = e.target.files[0]; if(!f) return; try{ const u = await uploadMedia(f, {textContent:""}); await db.collection("stories").add({ authorId: state.user.uid, imageUrl: u, createdAt: fieldValue.serverTimestamp() }); showToast("Hikaye eklendi", "fa-circle-check"); triggerHaptic("success"); } catch(er){ alert("Yüklenemedi."); } e.target.value = ""; });
  
  $("comment-form").addEventListener("submit", sendComment);
  $("chat-form").addEventListener("submit", sendMessage);
  $("profile-form").addEventListener("submit", saveProfile);
  $("new-message").addEventListener("click", () => { renderMessageUsers(); openModal("new-message-modal"); });
  $("back-to-conversations").addEventListener("click", () => { $("chat-pane").closest(".messages-layout").classList.remove("is-chat-open"); triggerHaptic(); });
  $("chat-user-button").addEventListener("click", () => state.activeChatUserId && openUserProfile(state.activeChatUserId));
  $("modal-layer").addEventListener("click", (e) => { if (e.target === $("modal-layer")) closeModals(); });
  document.querySelectorAll(".close-modal").forEach(btn => btn.addEventListener("click", closeModals));

  document.addEventListener("click", (e) => {
    const netAction = e.target.closest("[data-network-action]"); if (netAction) return openNetworkModal(netAction.dataset.networkAction, netAction.dataset.networkUid);
    const uBtn = e.target.closest("[data-user-id]"); if (uBtn) return openUserProfile(uBtn.dataset.userId);
    const fBtn = e.target.closest("[data-follow-id]"); if (fBtn) return toggleFollow(fBtn.dataset.followId);
    const mBtn = e.target.closest("[data-message-id]"); if (mBtn) return state.sharePostId ? sharePostTo(mBtn.dataset.messageId) : openChat(mBtn.dataset.messageId);
    const pBtn = e.target.closest("[data-post-action]");
    if (pBtn) {
      const id = pBtn.closest("[data-post-id]")?.dataset.postId; if (!id) return;
      if (pBtn.dataset.postAction === "like") likePost(id);
      if (pBtn.dataset.postAction === "comments") openComments(id);
      if (pBtn.dataset.postAction === "delete") deletePost(id);
      if (pBtn.dataset.postAction === "share") { state.sharePostId = id; renderMessageUsers(); openModal("new-message-modal"); }
      return;
    }
    const oBtn = e.target.closest("[data-open-post]"); if (oBtn) return openPostDetail(oBtn.dataset.openPost);
    const sBtn = e.target.closest("[data-story-id]"); if (sBtn) return openStory(sBtn.dataset.storyId);
    if (e.target.closest("[data-story-action='add']")) return $("story-input").click();
    if (e.target.closest("#edit-profile")) return openProfileEditor();
  });

  restoreTheme();
  auth.onAuthStateChanged(async (user) => {
    if (!user) { shutdownRealtimeData(); state.user = null; $("app-shell").hidden = true; $("auth-screen").hidden = false; setSplashGone(); return; }
    state.user = user;
    try {
      await db.collection("users").doc(user.uid).get().then(d => { if (!d.exists) return db.collection("users").doc(user.uid).set({ name: user.email?.split("@")[0] || "yeniüye", username: cleanHandle(user.email?.split("@")[0]).slice(0,20), bio: "Swipper'a katıldı ✦", following: [], followers: [] }); });
      $("auth-screen").hidden = true; $("app-shell").hidden = false; setSplashGone(); startRealtimeData(); showView("home"); showToast("Hoş geldin!", "fa-hand-sparkles");
    } catch (er) { showAuthError(firebaseError(er)); $("auth-screen").hidden = false; setSplashGone(); }
  });
});