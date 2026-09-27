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
    user: null,
    users: {},
    posts: [],
    stories: [],
    feed: "all",
    activeCommentPostId: null,
    activeChatUserId: null,
    selectedMedia: null,
    selectedStory: null,
    sharePostId: null,
    chatUnsubscribe: null,
    commentUnsubscribe: null,
    unsubscribers: [],
    postListenerStarted: false
  };

  // Mobil tarayıcılarda çift dokunuşla oluşan sayfa yakınlaştırmasını engeller.
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });

  const escapeHTML = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const cleanHandle = (value = "") => String(value).trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  const initials = (value = "S") => value.trim().slice(0, 1).toUpperCase() || "S";
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

  function setSplashGone() {
    setTimeout(() => $("splash-screen").classList.add("is-gone"), 450);
  }

  function showAuthError(message) {
    $("auth-error").textContent = message;
  }

  function firebaseError(error, fallback) {
    const copy = {
      "auth/invalid-email": "Geçerli bir e-posta adresi yaz.",
      "auth/user-not-found": "Bu bilgilerle bir hesap bulunamadı.",
      "auth/wrong-password": "Şifren doğru görünmüyor.",
      "auth/invalid-credential": "E-posta veya şifre doğru değil.",
      "auth/email-already-in-use": "Bu e-posta ile zaten bir hesap var.",
      "auth/weak-password": "Şifren en az 6 karakter olmalı.",
      "permission-denied": "Bu işlem için iznin yok. Firebase kurallarını kontrol et."
    };
    return copy[error?.code] || fallback || "Bir şey ters gitti. Lütfen tekrar dene.";
  }

  function openModal(id) {
    document.querySelectorAll(".modal").forEach((modal) => modal.hidden = true);
    $("modal-layer").hidden = false;
    $(id).hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModals() {
    document.querySelectorAll(".modal").forEach((modal) => modal.hidden = true);
    $("modal-layer").hidden = true;
    document.body.style.overflow = "";
    if (state.commentUnsubscribe) {
      state.commentUnsubscribe();
      state.commentUnsubscribe = null;
    }
  }

  function updateThemeButton() {
    const dark = document.body.classList.contains("is-dark");
    $("theme-toggle").querySelector("i").className = dark ? "fa-solid fa-sun" : "fa-regular fa-moon";
    $("theme-toggle").querySelector("span").textContent = dark ? "Açık tema" : "Tema";
  }

  function restoreTheme() {
    if (localStorage.getItem("swipper-theme") === "dark") document.body.classList.add("is-dark");
    updateThemeButton();
  }

  function setProfileSurfaces() {
    const profile = currentProfile();
    if (!state.user || !profile.username) return;
    const avatar = avatarFor(profile);
    [["side-user-avatar", avatar], ["quick-avatar", avatar], ["composer-avatar", avatar], ["bottom-avatar", avatar]].forEach(([id, src]) => {
      $(id).src = src;
      $(id).alt = profile.name || profile.username;
    });
    $("side-user-name").textContent = profile.name || profile.username;
    $("side-user-handle").textContent = `@${profile.username}`;
    $("composer-name").textContent = profile.name || profile.username;
    $("composer-handle").textContent = `@${profile.username}`;
  }

  function showView(view) {
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
    const stories = [
      `<button class="story story--add" type="button" data-story-action="add"><span class="story-ring"><img src="${escapeHTML(avatarFor(profile))}" alt=""></span><span>Hikayen</span></button>`
    ];
    state.stories.slice(0, 15).forEach((story) => {
      const user = state.users[story.authorId] || { username: "swipper" };
      stories.push(`<button class="story" type="button" data-story-id="${escapeHTML(story.id)}"><span class="story-ring"><img src="${escapeHTML(avatarFor(user))}" alt="${escapeHTML(user.username)}"></span><span>${escapeHTML(user.username || "üye")}</span></button>`);
    });
    root.innerHTML = stories.join("");
  }

  function mediaMarkup(post) {
    const url = postMedia(post);
    if (!url) return "";
    if (isVideo(post)) return `<div class="post-media"><video src="${escapeHTML(url)}" controls playsinline preload="metadata"></video></div>`;
    return `<div class="post-media"><img src="${escapeHTML(url)}" alt="Paylaşım görseli" loading="lazy"></div>`;
  }

  function postMarkup(post) {
    const author = state.users[post.authorId] || { username: "swipper", name: "Swipper üyesi" };
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const liked = likes.includes(state.user?.uid);
    const canManage = post.authorId === state.user?.uid;
    const content = postText(post);
    return `<article class="post-card" data-post-id="${escapeHTML(post.id)}">
      <div class="post-main">
        <header class="post-head">
          <button type="button" data-user-id="${escapeHTML(post.authorId)}"><img src="${escapeHTML(avatarFor(author))}" alt=""></button>
          <button class="post-author" type="button" data-user-id="${escapeHTML(post.authorId)}"><b>${escapeHTML(author.name || author.username || "Swipper üyesi")}</b><span>@${escapeHTML(author.username || "uye")} · ${formatDate(post.createdAt)}</span></button>
          ${canManage ? `<button class="post-more" type="button" data-post-action="delete" title="Gönderiyi sil" aria-label="Gönderiyi sil"><i class="fa-solid fa-trash-can"></i></button>` : ""}
        </header>
        ${content ? `<p class="post-text">${escapeHTML(content)}</p>` : ""}
        ${mediaMarkup(post)}
        <footer class="post-actions">
          <button class="reaction-button ${liked ? "is-liked" : ""}" type="button" data-post-action="like"><i class="${liked ? "fa-solid" : "fa-regular"} fa-heart"></i><span>${likes.length || ""}</span></button>
          <button class="reaction-button" type="button" data-post-action="comments"><i class="fa-regular fa-comment"></i><span>${Number(post.commentsCount || 0) || ""}</span></button>
          <button class="reaction-button reaction-button--share" type="button" data-post-action="share"><i class="fa-regular fa-paper-plane"></i></button>
          <span class="post-date">${formatDate(post.createdAt)}</span>
        </footer>
      </div>
      <div class="post-comment-peek"><button type="button" data-post-action="comments">Yoruma katıl</button></div>
    </article>`;
  }

  function renderFeed() {
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const posts = state.feed === "following" ? state.posts.filter((post) => following.includes(post.authorId)) : state.posts;
    $("feed").innerHTML = posts.map(postMarkup).join("");
    $("empty-feed").hidden = posts.length > 0;
    document.querySelectorAll(".feed-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.feed === state.feed));
  }

  function renderExplore() {
    const query = $("user-search").value.trim().toLocaleLowerCase("tr-TR");
    $("clear-search").hidden = !query;
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const photoPosts = state.posts.filter((post) => postMedia(post)).slice(0, 24);
    $("explore-gallery").innerHTML = photoPosts.length ? photoPosts.map((post) => {
      const media = postMedia(post);
      const likes = Array.isArray(post.likes) ? post.likes.length : 0;
      const visual = isVideo(post)
        ? `<video src="${escapeHTML(media)}" muted playsinline preload="metadata"></video>`
        : `<img src="${escapeHTML(media)}" alt="Keşfet paylaşımı" loading="lazy">`;
      return `<button class="explore-tile" type="button" data-open-post="${escapeHTML(post.id)}">${visual}<span class="explore-tile-badge"><i class="${isVideo(post) ? "fa-solid fa-play" : "fa-regular fa-heart"}"></i>${likes || ""}</span></button>`;
    }).join("") : `<div class="explore-gallery-empty"><span><i class="fa-regular fa-image"></i> Fotoğraf paylaşıldığında burada Instagram tarzı bir keşfet akışı oluşacak.</span></div>`;
    const people = Object.entries(state.users)
      .filter(([uid, person]) => uid !== state.user?.uid && `${person.name || ""} ${person.username || ""}`.toLocaleLowerCase("tr-TR").includes(query))
      .sort(([, a], [, b]) => String(a.username || "").localeCompare(String(b.username || ""), "tr"));
    $("explore-people-count").textContent = people.length ? `${people.length} kişi` : "";
    $("explore-users").innerHTML = people.length ? people.map(([uid, person]) => `<article class="user-card">
      <button class="user-card-top" type="button" data-user-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span class="user-card-info"><b>${escapeHTML(person.name || person.username || "Swipper üyesi")}</b><span>@${escapeHTML(person.username || "uye")}</span></span></button>
      <p>${escapeHTML(person.bio || "Swipper'da yeni fikirler keşfediyor.")}</p>
      <button class="button ${following.includes(uid) ? "button--soft" : "button--primary"}" type="button" data-follow-id="${escapeHTML(uid)}">${following.includes(uid) ? "Takipte" : "Takip et"}</button>
    </article>`).join("") : `<div class="empty-state"><span class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></span><h3>Kimse bulunamadı</h3><p>Farklı bir isim ya da kullanıcı adı dene.</p></div>`;
  }

  function userPosts(uid) { return state.posts.filter((post) => post.authorId === uid); }

  function profileMarkup(profile, uid, isOwn) {
    const posts = userPosts(uid);
    const following = Array.isArray(currentProfile().following) ? currentProfile().following : [];
    const isFollowing = following.includes(uid);
    const grid = posts.length ? posts.map((post) => {
      const media = postMedia(post);
      if (media) return `<button class="profile-grid-item" type="button" data-open-post="${escapeHTML(post.id)}">${isVideo(post) ? `<video src="${escapeHTML(media)}" muted preload="metadata"></video>` : `<img src="${escapeHTML(media)}" alt="">`}</button>`;
      return `<button class="profile-grid-item profile-text-post" type="button" data-open-post="${escapeHTML(post.id)}">${escapeHTML(postText(post).slice(0, 70) || "Not")}</button>`;
    }).join("") : `<div class="empty-state"><span class="empty-icon"><i class="fa-regular fa-image"></i></span><h3>Henüz paylaşım yok</h3><p>${isOwn ? "İlk anını paylaş ve profilini canlandır." : "Bu profil henüz bir şey paylaşmadı."}</p></div>`;
    return `<div class="profile-hero"><div class="profile-hero-top"><img class="profile-avatar" src="${escapeHTML(avatarFor(profile))}" alt="${escapeHTML(profile.name || profile.username || "Profil")}"><div class="profile-head-copy"><h2>${escapeHTML(profile.name || profile.username || "Swipper üyesi")}</h2><span>@${escapeHTML(profile.username || "uye")}</span></div></div>
      <p class="profile-bio">${escapeHTML(profile.bio || "Swipper'da yeni fikirler keşfediyor.")}</p>
      <div class="profile-actions">${isOwn ? `<button id="edit-profile" class="button button--soft" type="button"><i class="fa-regular fa-pen-to-square"></i>Profili düzenle</button><button id="profile-share" class="button button--primary" type="button"><i class="fa-solid fa-plus"></i>Paylaş</button>` : `<button class="button ${isFollowing ? "button--soft" : "button--primary"}" type="button" data-follow-id="${escapeHTML(uid)}">${isFollowing ? "Takipte" : "Takip et"}</button><button class="button button--soft" type="button" data-message-id="${escapeHTML(uid)}"><i class="fa-regular fa-paper-plane"></i>Mesaj</button>`}</div>
      <div class="profile-stats"><span class="profile-stat"><b>${posts.length}</b><span>Paylaşım</span></span><span class="profile-stat"><b>${Array.isArray(profile.followers) ? profile.followers.length : 0}</b><span>Takipçi</span></span><span class="profile-stat"><b>${Array.isArray(profile.following) ? profile.following.length : 0}</b><span>Takip</span></span></div></div>
      <div class="profile-section-heading"><h3>Paylaşımlar</h3><span>${posts.length} içerik</span></div><div class="profile-grid">${grid}</div>`;
  }

  function renderProfile() {
    if (!state.user) return;
    $("profile-content").innerHTML = profileMarkup(currentProfile(), state.user.uid, true);
  }

  function openUserProfile(uid) {
    const profile = state.users[uid];
    if (!profile) return;
    $("user-modal-content").innerHTML = `<div class="user-profile">${profileMarkup(profile, uid, uid === state.user?.uid)}</div>`;
    openModal("user-modal");
  }

  function openPostDetail(id) {
    const post = state.posts.find((item) => item.id === id);
    if (!post) return;
    const author = state.users[post.authorId] || { name: "Swipper üyesi" };
    $("post-modal-title").textContent = author.name || author.username || "Akıştan bir an";
    $("post-modal-content").innerHTML = postMarkup(post);
    openModal("post-modal");
  }

  function renderConversationList() {
    const people = Object.entries(state.users).filter(([uid]) => uid !== state.user?.uid).sort(([, a], [, b]) => String(a.name || "").localeCompare(String(b.name || ""), "tr"));
    $("conversation-list").innerHTML = people.length ? people.map(([uid, person]) => `<button class="conversation-item ${state.activeChatUserId === uid ? "is-active" : ""}" type="button" data-message-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span class="conversation-copy"><b>${escapeHTML(person.name || person.username || "Swipper üyesi")}</b><span>@${escapeHTML(person.username || "uye")} ile sohbet et</span></span></button>`).join("") : `<div class="empty-state"><span class="empty-icon"><i class="fa-regular fa-comment"></i></span><h3>Henüz kimse yok</h3><p>Keşfet bölümünden insanlarla bağlantı kur.</p></div>`;
  }

  function renderMessageUsers() {
    const root = $("message-user-list");
    const people = Object.entries(state.users).filter(([uid]) => uid !== state.user?.uid);
    root.innerHTML = people.length ? people.map(([uid, person]) => `<button class="message-user" type="button" data-message-id="${escapeHTML(uid)}"><img src="${escapeHTML(avatarFor(person))}" alt=""><span><b>${escapeHTML(person.name || person.username || "Swipper üyesi")}</b><small>@${escapeHTML(person.username || "uye")}</small></span></button>`).join("") : `<div class="empty-state"><span class="empty-icon"><i class="fa-regular fa-user"></i></span><h3>Henüz başka üye yok</h3><p>Yeni üyeler burada görünecek.</p></div>`;
  }

  function openChat(uid) {
    const person = state.users[uid];
    if (!person || !state.user) return;
    closeModals();
    state.activeChatUserId = uid;
    $("chat-user-avatar").src = avatarFor(person);
    $("chat-user-avatar").alt = person.name || person.username;
    $("chat-user-name").textContent = person.name || person.username;
    $("chat-user-handle").textContent = `@${person.username || "uye"}`;
    $("chat-placeholder").hidden = true;
    $("chat-content").hidden = false;
    $("chat-pane").closest(".messages-layout").classList.add("is-chat-open");
    showView("messages");
    renderConversationList();
    if (state.chatUnsubscribe) state.chatUnsubscribe();
    const room = chatIdFor(state.user.uid, uid);
    state.chatUnsubscribe = db.collection("chats").doc(room).collection("messages").orderBy("createdAt", "asc").onSnapshot((snapshot) => {
      $("chat-messages").innerHTML = snapshot.docs.map((doc) => {
        const message = doc.data();
        return `<div class="message ${message.senderId === state.user.uid ? "message--mine" : "message--theirs"}">${escapeHTML(message.text || "")}</div>`;
      }).join("");
      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    }, () => { $("chat-messages").innerHTML = `<div class="empty-state"><p>Mesajlar şu an yüklenemiyor.</p></div>`; });
  }

  async function toggleFollow(uid) {
    if (!state.user || uid === state.user.uid) return;
    const profile = currentProfile();
    const following = Array.isArray(profile.following) ? profile.following : [];
    const followed = following.includes(uid);
    try {
      await Promise.all([
        db.collection("users").doc(state.user.uid).update({ following: followed ? fieldValue.arrayRemove(uid) : fieldValue.arrayUnion(uid) }),
        db.collection("users").doc(uid).update({ followers: followed ? fieldValue.arrayRemove(state.user.uid) : fieldValue.arrayUnion(state.user.uid) })
      ]);
    } catch (error) { alert(firebaseError(error, "Takip işlemi gerçekleştirilemedi.")); }
  }

  function openComposer() {
    state.selectedMedia = null;
    $("media-input").value = "";
    $("media-preview").hidden = true;
    $("media-preview").innerHTML = "";
    $("post-text").value = "";
    $("char-count").textContent = "0/1200";
    $("upload-status").textContent = "";
    openModal("composer-modal");
    setTimeout(() => $("post-text").focus(), 80);
  }

  function previewMedia(file) {
    const url = URL.createObjectURL(file);
    const preview = $("media-preview");
    const visual = file.type.startsWith("video/") ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}" alt="Seçilen medya">`;
    preview.innerHTML = `${visual}<button id="remove-media" type="button" aria-label="Medyayı kaldır"><i class="fa-solid fa-xmark"></i></button>`;
    preview.hidden = false;
    $("remove-media").onclick = () => {
      URL.revokeObjectURL(url);
      state.selectedMedia = null;
      $("media-input").value = "";
      preview.hidden = true;
      preview.innerHTML = "";
    };
  }

  async function uploadMedia(file, messageTarget) {
    if (file.size > 50 * 1024 * 1024) throw new Error("Fotoğraf veya video 50 MB'dan küçük olmalı.");
    messageTarget.textContent = "Medya hazırlanıyor ve yükleniyor…";
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", file);
    const response = await fetch("https://corsproxy.io/?https://catbox.moe/user/api.php", { method: "POST", body: formData });
    if (!response.ok) throw new Error("Medya yüklenemedi. Lütfen bağlantını kontrol edip tekrar dene.");
    const url = (await response.text()).trim();
    if (!safeMediaURL(url)) throw new Error("Yüklenen medya için güvenli bir bağlantı alınamadı.");
    return url;
  }

  async function publishPost(event) {
    event.preventDefault();
    const text = $("post-text").value.trim();
    if (!text && !state.selectedMedia) { $("upload-status").textContent = "Bir not yaz veya medya ekle."; return; }
    const button = $("publish-btn");
    button.disabled = true;
    try {
      let mediaUrl = "";
      if (state.selectedMedia) mediaUrl = await uploadMedia(state.selectedMedia, $("upload-status"));
      await db.collection("posts").add({
        authorId: state.user.uid,
        text,
        caption: text,
        mediaUrl,
        imageUrl: mediaUrl,
        mediaType: state.selectedMedia?.type.startsWith("video/") ? "video" : state.selectedMedia ? "image" : "",
        likes: [],
        commentsCount: 0,
        createdAt: fieldValue.serverTimestamp()
      });
      closeModals();
    } catch (error) { $("upload-status").textContent = error.message || firebaseError(error); }
    finally { button.disabled = false; }
  }

  async function createStory(file) {
    if (!file || !state.user) return;
    try {
      const progress = { textContent: "" };
      const url = await uploadMedia(file, progress);
      await db.collection("stories").add({ authorId: state.user.uid, imageUrl: url, createdAt: fieldValue.serverTimestamp() });
    } catch (error) { alert(error.message || "Hikaye yüklenemedi."); }
  }

  async function likePost(id) {
    if (!state.user) return;
    const ref = db.collection("posts").doc(id);
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (!doc.exists) return;
        const likes = Array.isArray(doc.data().likes) ? doc.data().likes : [];
        const next = likes.includes(state.user.uid) ? likes.filter((item) => item !== state.user.uid) : [...likes, state.user.uid];
        transaction.update(ref, { likes: next });
      });
    } catch (error) { alert(firebaseError(error, "Beğeni kaydedilemedi.")); }
  }

  async function deletePost(id) {
    if (!window.confirm("Bu paylaşım silinsin mi? Bu işlem geri alınamaz.")) return;
    try { await db.collection("posts").doc(id).delete(); }
    catch (error) { alert(firebaseError(error, "Paylaşım silinemedi.")); }
  }

  function openComments(id) {
    state.activeCommentPostId = id;
    $("comments-list").innerHTML = "";
    $("comment-input").value = "";
    openModal("comments-modal");
    if (state.commentUnsubscribe) state.commentUnsubscribe();
    state.commentUnsubscribe = db.collection("posts").doc(id).collection("comments").orderBy("createdAt", "asc").onSnapshot((snapshot) => {
      $("comments-list").innerHTML = snapshot.docs.length ? snapshot.docs.map((doc) => {
        const comment = doc.data();
        const author = state.users[comment.authorId] || { username: "üye" };
        return `<article class="comment"><img class="comment-avatar" src="${escapeHTML(avatarFor(author))}" alt=""><div class="comment-body"><b>@${escapeHTML(author.username || "uye")}</b><p>${escapeHTML(comment.text || "")}</p></div></article>`;
      }).join("") : `<div class="empty-state"><span class="empty-icon"><i class="fa-regular fa-comment"></i></span><h3>İlk yorumu sen bırak</h3><p>Bu paylaşım için henüz konuşma başlamadı.</p></div>`;
      $("comments-list").scrollTop = $("comments-list").scrollHeight;
    }, () => { $("comments-list").innerHTML = `<div class="empty-state"><p>Yorumlar yüklenemedi.</p></div>`; });
  }

  async function sendComment(event) {
    event.preventDefault();
    const text = $("comment-input").value.trim();
    if (!text || !state.activeCommentPostId) return;
    const post = state.posts.find((item) => item.id === state.activeCommentPostId);
    try {
      await db.collection("posts").doc(state.activeCommentPostId).collection("comments").add({ authorId: state.user.uid, text, createdAt: fieldValue.serverTimestamp() });
      if (post) await db.collection("posts").doc(state.activeCommentPostId).update({ commentsCount: fieldValue.increment(1) });
      $("comment-input").value = "";
    } catch (error) { alert(firebaseError(error, "Yorum gönderilemedi.")); }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = $("chat-input").value.trim();
    if (!text || !state.activeChatUserId || !state.user) return;
    try {
      await db.collection("chats").doc(chatIdFor(state.user.uid, state.activeChatUserId)).collection("messages").add({ senderId: state.user.uid, text, createdAt: fieldValue.serverTimestamp() });
      $("chat-input").value = "";
    } catch (error) { alert(firebaseError(error, "Mesaj gönderilemedi.")); }
  }

  async function sharePostTo(uid) {
    const post = state.posts.find((item) => item.id === state.sharePostId);
    if (!post || !state.user) return openChat(uid);
    const author = state.users[post.authorId] || { name: "Bir üye" };
    const summary = postText(post).slice(0, 180) || "Bir fotoğraf paylaştı.";
    try {
      await db.collection("chats").doc(chatIdFor(state.user.uid, uid)).collection("messages").add({
        senderId: state.user.uid,
        text: `↗ ${author.name || author.username || "Bir üye"} paylaşımı: ${summary}`,
        createdAt: fieldValue.serverTimestamp()
      });
      state.sharePostId = null;
      openChat(uid);
    } catch (error) { alert(firebaseError(error, "Paylaşım gönderilemedi.")); }
  }

  function openStory(id) {
    const story = state.stories.find((item) => item.id === id);
    if (!story) return;
    const author = state.users[story.authorId] || { username: "swipper" };
    const url = safeMediaURL(story.imageUrl || story.mediaUrl);
    if (!url) return;
    $("story-content").innerHTML = `<div class="story-view"><img src="${escapeHTML(url)}" alt="Hikaye"><div class="story-copy"><img src="${escapeHTML(avatarFor(author))}" alt=""><span><b>${escapeHTML(author.name || author.username || "Swipper üyesi")}</b><small>@${escapeHTML(author.username || "uye")} · ${formatDate(story.createdAt)}</small></span></div></div>`;
    openModal("story-modal");
  }

  function openProfileEditor() {
    const profile = currentProfile();
    $("profile-name-input").value = profile.name || "";
    $("profile-handle-input").value = profile.username || "";
    $("profile-bio-input").value = profile.bio || "";
    $("profile-error").textContent = "";
    openModal("profile-modal");
  }

  async function saveProfile(event) {
    event.preventDefault();
    const name = $("profile-name-input").value.trim();
    const username = cleanHandle($("profile-handle-input").value);
    const bio = $("profile-bio-input").value.trim();
    if (!name || username.length < 3) { $("profile-error").textContent = "Adını ve en az 3 karakterlik bir kullanıcı adını yaz."; return; }
    const duplicate = Object.entries(state.users).find(([uid, person]) => uid !== state.user.uid && cleanHandle(person.username) === username);
    if (duplicate) { $("profile-error").textContent = "Bu kullanıcı adı zaten alınmış."; return; }
    try { await db.collection("users").doc(state.user.uid).update({ name, username, bio }); closeModals(); }
    catch (error) { $("profile-error").textContent = firebaseError(error, "Profil kaydedilemedi."); }
  }

  function ensureProfile(user) {
    return db.collection("users").doc(user.uid).get().then((doc) => {
      if (doc.exists) return;
      const name = user.email?.split("@")[0] || "yeniüye";
      const username = cleanHandle(name).slice(0, 20) || `uye${user.uid.slice(0, 5)}`;
      return db.collection("users").doc(user.uid).set({ name, username, bio: "Swipper'a yeni katıldı ✦", avatar: "", following: [], followers: [] });
    });
  }

  function startRealtimeData() {
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];
    state.unsubscribers.push(db.collection("users").onSnapshot((snapshot) => {
      state.users = {};
      snapshot.forEach((doc) => state.users[doc.id] = doc.data());
      setProfileSurfaces(); renderStories(); renderFeed(); renderExplore(); renderProfile(); renderConversationList(); renderMessageUsers();
    }, () => { alert("Kullanıcı verileri yüklenemedi. Firebase kurallarını kontrol et."); }));
    state.unsubscribers.push(db.collection("posts").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
      state.posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      renderFeed(); renderProfile();
    }, () => { $("feed").innerHTML = `<div class="empty-state"><span class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></span><h3>Akış yüklenemedi</h3><p>Firebase bağlantısını ve güvenlik kurallarını kontrol et.</p></div>`; }));
    state.unsubscribers.push(db.collection("stories").orderBy("createdAt", "desc").limit(20).onSnapshot((snapshot) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      state.stories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((story) => !dateFrom(story.createdAt) || dateFrom(story.createdAt).getTime() > cutoff);
      renderStories();
    }, () => { state.stories = []; renderStories(); }));
  }

  function shutdownRealtimeData() {
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];
    if (state.chatUnsubscribe) state.chatUnsubscribe();
    if (state.commentUnsubscribe) state.commentUnsubscribe();
    state.chatUnsubscribe = null;
    state.commentUnsubscribe = null;
  }

  $("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showAuthError("");
    try { await auth.signInWithEmailAndPassword($("auth-email").value.trim(), $("auth-password").value); }
    catch (error) { showAuthError(firebaseError(error, "Giriş yapılamadı.")); }
  });
  $("register-btn").addEventListener("click", async () => {
    showAuthError("");
    try { await auth.createUserWithEmailAndPassword($("auth-email").value.trim(), $("auth-password").value); }
    catch (error) { showAuthError(firebaseError(error, "Hesap oluşturulamadı.")); }
  });
  $("logout-btn").addEventListener("click", () => auth.signOut());
  $("theme-toggle").addEventListener("click", () => { document.body.classList.toggle("is-dark"); localStorage.setItem("swipper-theme", document.body.classList.contains("is-dark") ? "dark" : "light"); updateThemeButton(); });
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  [$("open-composer"), $("open-composer-side"), $("mobile-compose"), $("bottom-compose")].forEach((button) => button.addEventListener("click", openComposer));
  document.querySelectorAll(".open-composer-trigger").forEach((button) => button.addEventListener("click", openComposer));
  $("refresh-feed").addEventListener("click", () => { renderFeed(); $("refresh-feed").querySelector("i").classList.add("fa-spin"); setTimeout(() => $("refresh-feed").querySelector("i").classList.remove("fa-spin"), 400); });
  $("user-search").addEventListener("input", renderExplore);
  $("clear-search").addEventListener("click", () => { $("user-search").value = ""; renderExplore(); $("user-search").focus(); });
  document.querySelectorAll(".feed-tab").forEach((button) => button.addEventListener("click", () => { state.feed = button.dataset.feed; renderFeed(); }));
  $("composer-form").addEventListener("submit", publishPost);
  $("post-text").addEventListener("input", () => $("char-count").textContent = `${$("post-text").value.length}/1200`);
  $("media-input").addEventListener("change", (event) => { const file = event.target.files[0]; if (!file) return; state.selectedMedia = file; previewMedia(file); });
  $("story-input").addEventListener("change", async (event) => { await createStory(event.target.files[0]); event.target.value = ""; });
  $("comment-form").addEventListener("submit", sendComment);
  $("chat-form").addEventListener("submit", sendMessage);
  $("profile-form").addEventListener("submit", saveProfile);
  $("new-message").addEventListener("click", () => { renderMessageUsers(); openModal("new-message-modal"); });
  $("back-to-conversations").addEventListener("click", () => $("chat-pane").closest(".messages-layout").classList.remove("is-chat-open"));
  $("chat-user-button").addEventListener("click", () => state.activeChatUserId && openUserProfile(state.activeChatUserId));
  $("modal-layer").addEventListener("click", (event) => { if (event.target === $("modal-layer")) closeModals(); });
  document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", closeModals));

  document.addEventListener("click", (event) => {
    const userButton = event.target.closest("[data-user-id]");
    if (userButton) { openUserProfile(userButton.dataset.userId); return; }
    const followButton = event.target.closest("[data-follow-id]");
    if (followButton) { toggleFollow(followButton.dataset.followId); return; }
    const messageButton = event.target.closest("[data-message-id]");
    if (messageButton) { state.sharePostId ? sharePostTo(messageButton.dataset.messageId) : openChat(messageButton.dataset.messageId); return; }
    const postButton = event.target.closest("[data-post-action]");
    if (postButton) {
      const id = postButton.closest("[data-post-id]")?.dataset.postId;
      if (!id) return;
      if (postButton.dataset.postAction === "like") likePost(id);
      if (postButton.dataset.postAction === "comments") openComments(id);
      if (postButton.dataset.postAction === "delete") deletePost(id);
      if (postButton.dataset.postAction === "share") { state.sharePostId = id; renderMessageUsers(); openModal("new-message-modal"); }
      return;
    }
    const openPost = event.target.closest("[data-open-post]");
    if (openPost) { openPostDetail(openPost.dataset.openPost); return; }
    const storyButton = event.target.closest("[data-story-id]");
    if (storyButton) { openStory(storyButton.dataset.storyId); return; }
    if (event.target.closest("[data-story-action='add']")) { $("story-input").click(); return; }
    if (event.target.closest("#edit-profile")) { openProfileEditor(); return; }
    if (event.target.closest("#profile-share")) { closeModals(); openComposer(); }
  });

  restoreTheme();
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      shutdownRealtimeData();
      state.user = null; state.users = {}; state.posts = []; state.stories = [];
      $("app-shell").hidden = true;
      $("auth-screen").hidden = false;
      setSplashGone();
      return;
    }
    state.user = user;
    try {
      await ensureProfile(user);
      $("auth-screen").hidden = true;
      $("app-shell").hidden = false;
      setSplashGone();
      startRealtimeData();
      showView("home");
    } catch (error) { showAuthError(firebaseError(error, "Hesap hazırlanamadı.")); $("auth-screen").hidden = false; setSplashGone(); }
  });
});

