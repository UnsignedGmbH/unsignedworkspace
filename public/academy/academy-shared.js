/* ─────────────────────────────────────────────────────────────────────
 * UWAcademy — gemeinsame Logik für /academy (Kunde + Vorschau) und
 * /academy-admin (Editor). Kein Framework: hängt sich als
 * window.UWAcademy an (analog zu public/push-client.js).
 *
 * Enthält: HTML-Sanitizer (Allowlist), Video-Erkennung + Embed,
 * Sortierung, Freischalt-Logik (computeAccess), Lesson-Body-Renderer.
 * ──────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── Escaping ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  var escapeAttr = escapeHtml;

  // ── HTML-Sanitizer (Allowlist) ────────────────────────────────────
  // Wird beim SPEICHERN (Editor) UND beim RENDERN (Kundenseite) benutzt,
  // damit auch Altdaten / fremde Writes nie unsauberes HTML ausliefern.
  var ALLOWED_TAGS = {
    P: 1, BR: 1, DIV: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1,
    H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, A: 1, BLOCKQUOTE: 1,
  };
  var DROP_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, FORM: 1, INPUT: 1, TEXTAREA: 1, BUTTON: 1, SVG: 1, MATH: 1 };

  function cleanNode(node) {
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (child) {
      if (child.nodeType === 3) return; // Text bleibt
      if (child.nodeType !== 1) { node.removeChild(child); return; }
      var tag = child.tagName;
      if (DROP_TAGS[tag]) { node.removeChild(child); return; }
      cleanNode(child);
      if (!ALLOWED_TAGS[tag]) {
        // Unbekanntes Tag: auspacken, Kinder behalten
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      var href = tag === "A" ? (child.getAttribute("href") || "") : "";
      // ALLE Attribute strippen (keine Event-Handler, kein style, …)
      Array.prototype.slice.call(child.attributes).forEach(function (a) {
        child.removeAttribute(a.name);
      });
      if (tag === "A") {
        href = href.trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          child.setAttribute("href", href);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        }
      }
    });
  }

  function sanitizeHtml(html) {
    if (!html) return "";
    var doc;
    try {
      doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    } catch (e) { return ""; }
    var root = doc.body && doc.body.firstChild;
    if (!root) return "";
    cleanNode(root);
    return root.innerHTML;
  }

  // ── Video ─────────────────────────────────────────────────────────
  // detectVideo("https://youtu.be/abc") → {type:"youtube", id:"abc"}
  // detectVideo("https://cdn…/video.mp4") → {type:"hosted", url}
  // detectVideo("") → null
  function detectVideo(url) {
    url = (url || "").trim();
    if (!url) return null;
    var m = url.match(
      /(?:youtube\.com\/(?:watch\?(?:.*[?&])?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/
    );
    if (m) return { type: "youtube", id: m[1] };
    if (/youtube\.com|youtu\.be/i.test(url)) return { type: "youtube", id: "" }; // YouTube erkannt, ID nicht lesbar
    return { type: "hosted", url: url };
  }

  function videoEmbedHtml(videoType, videoUrl) {
    videoUrl = (videoUrl || "").trim();
    if (!videoUrl) return "";
    if (videoType === "youtube") {
      var d = detectVideo(videoUrl);
      if (!d || d.type !== "youtube" || !d.id) {
        return '<div class="uwa-video-warn">⚠️ YouTube-Link nicht erkannt — bitte URL prüfen.</div>';
      }
      return (
        '<div class="uwa-video"><iframe src="https://www.youtube-nocookie.com/embed/' +
        d.id +
        '?rel=0&modestbranding=1" title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>'
      );
    }
    // Eigenes Video (direkte URL)
    if (!/^https?:\/\//i.test(videoUrl)) {
      return '<div class="uwa-video-warn">⚠️ Video-URL muss mit https:// beginnen.</div>';
    }
    var hint = /\.m3u8(\?|$)/i.test(videoUrl)
      ? '<div class="uwa-video-warn">Hinweis: .m3u8-Streams spielen nur in Safari nativ — für alle Browser besser eine .mp4-URL nutzen.</div>'
      : "";
    return (
      '<div class="uwa-video"><video controls playsinline preload="metadata" src="' +
      escapeAttr(videoUrl) +
      '"></video></div>' + hint
    );
  }

  // ── Sortierung ────────────────────────────────────────────────────
  // RTDB speichert Kinder als Objekte mit push-ids; hier → Array nach order.
  function toArr(obj) {
    if (!obj) return [];
    return Object.keys(obj)
      .map(function (k) {
        var v = obj[k];
        var out = { id: k };
        if (v && typeof v === "object") {
          Object.keys(v).forEach(function (p) { out[p] = v[p]; });
        }
        return out;
      })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function sortModules(content, opts) {
    opts = opts || {};
    var mods = toArr(content && content.modules);
    if (!opts.includeUnpublished) {
      mods = mods.filter(function (m) { return !!m.published; });
    }
    return mods;
  }

  function sortLessons(mod, opts) {
    opts = opts || {};
    var ls = toArr(mod && mod.lessons);
    if (!opts.includeUnpublished) {
      ls = ls.filter(function (l) { return !!l.published; });
    }
    return ls;
  }

  // ── Freischalt-Logik ──────────────────────────────────────────────
  // Iteriert über den CONTENT (nicht über Progress) → verwaiste
  // Progress-Einträge gelöschter Lektionen sind automatisch harmlos.
  //
  // Semantik: Kurs-Module nach order, Lektionen darin nach order →
  // EINE globale Sequenz. Zugänglich = alles Erledigte (bleibt immer
  // ansehbar) + die ERSTE nicht erledigte Lektion. Fügt ein Admin
  // später eine Lektion VOR bereits erledigte ein, wird niemand
  // rückwirkend ausgesperrt — die neue Lektion wird einfach die
  // aktuelle. type:"open"-Module (Marketing) sind immer komplett offen.
  //
  // computeAccess(content, progress, {unlockAll, includeUnpublished}) →
  // { lessons: {lid:{done,accessible,current,moduleId}},
  //   modules: {mid:{unlocked,open,done,total,pct,complete}},
  //   pct, courseDone, courseTotal, currentLessonId, nextAfter:{lid:nextLid} }
  function computeAccess(content, progress, opts) {
    opts = opts || {};
    progress = progress || {};
    var listOpts = { includeUnpublished: !!opts.includeUnpublished };
    var res = {
      lessons: {}, modules: {}, pct: 0,
      courseDone: 0, courseTotal: 0,
      currentLessonId: null, nextAfter: {},
    };
    var mods = sortModules(content, listOpts);
    var courseSeq = [];

    mods.forEach(function (m) {
      var ls = sortLessons(m, listOpts);
      if (m.type === "open") {
        var doneOpen = 0;
        ls.forEach(function (l) {
          var done = !!(progress[l.id] && progress[l.id].done);
          if (done) doneOpen++;
          res.lessons[l.id] = { done: done, accessible: true, current: false, moduleId: m.id };
        });
        res.modules[m.id] = {
          unlocked: true, open: true, done: doneOpen, total: ls.length,
          pct: ls.length ? Math.round((doneOpen / ls.length) * 100) : 0,
          complete: ls.length > 0 && doneOpen === ls.length,
        };
      } else {
        ls.forEach(function (l) { courseSeq.push({ lesson: l, moduleId: m.id }); });
      }
    });

    var currentFound = false;
    courseSeq.forEach(function (e, i) {
      var l = e.lesson;
      var done = !!(progress[l.id] && progress[l.id].done);
      if (done) res.courseDone++;
      var current = false;
      var accessible = done;
      if (!done && !currentFound) {
        current = true;
        accessible = true;
        currentFound = true;
        res.currentLessonId = l.id;
      }
      if (opts.unlockAll) accessible = true;
      res.lessons[l.id] = { done: done, accessible: accessible, current: current, moduleId: e.moduleId };
      if (i + 1 < courseSeq.length) res.nextAfter[l.id] = courseSeq[i + 1].lesson.id;
    });

    mods.forEach(function (m) {
      if (m.type === "open") return;
      var ls = sortLessons(m, listOpts);
      var done = 0, anyAccessible = false;
      ls.forEach(function (l) {
        var st = res.lessons[l.id] || {};
        if (st.done) done++;
        if (st.accessible) anyAccessible = true;
      });
      res.modules[m.id] = {
        // Leeres Modul blockiert nichts und zeigt kein Schloss
        unlocked: !!opts.unlockAll || anyAccessible || ls.length === 0,
        open: false, done: done, total: ls.length,
        pct: ls.length ? Math.round((done / ls.length) * 100) : 0,
        complete: ls.length > 0 && done === ls.length,
      };
    });

    res.courseTotal = courseSeq.length;
    res.pct = courseSeq.length ? Math.round((res.courseDone / courseSeq.length) * 100) : 0;
    return res;
  }

  // ── Lesson-Body (Text + Links) ────────────────────────────────────
  function lessonBodyHtml(lesson) {
    var html = "";
    if (lesson && lesson.contentHtml) {
      html += '<div class="uwa-prose">' + sanitizeHtml(lesson.contentHtml) + "</div>";
    }
    var links = toArr(lesson && lesson.links).filter(function (l) { return l.url; });
    if (links.length) {
      html +=
        '<div class="uwa-links">' +
        links
          .map(function (l) {
            var url = /^https?:\/\//i.test(l.url) ? l.url : "https://" + l.url;
            return (
              '<a class="uwa-linkbtn" href="' + escapeAttr(url) +
              '" target="_blank" rel="noopener noreferrer">🔗 <span>' +
              escapeHtml(l.label || l.url) + "</span></a>"
            );
          })
          .join("") +
        "</div>";
    }
    return html;
  }

  // ── Basis-CSS (einmalig injizieren) ───────────────────────────────
  // Styles für .uwa-video / .uwa-prose / .uwa-links, damit Kundenseite
  // und Admin-Vorschau identisch rendern.
  var cssInjected = false;
  function injectBaseCss() {
    if (cssInjected) return;
    cssInjected = true;
    var css = [
      ".uwa-video{position:relative;aspect-ratio:16/9;background:#0a0a0a;border-radius:12px;overflow:hidden}",
      ".uwa-video iframe,.uwa-video video{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}",
      ".uwa-video-warn{margin-top:8px;font:600 11px Montserrat,system-ui,sans-serif;color:#8a6d1a;background:#fdf6e3;border:0.5px solid rgba(138,109,26,0.3);border-radius:10px;padding:8px 12px}",
      ".uwa-prose{font-size:13.5px;line-height:1.75;color:var(--color-ink,#111)}",
      ".uwa-prose p,.uwa-prose div{margin:0 0 10px}",
      ".uwa-prose h2{font-size:17px;font-weight:800;margin:22px 0 8px;line-height:1.3}",
      ".uwa-prose h3{font-size:14px;font-weight:800;margin:18px 0 6px;line-height:1.3}",
      ".uwa-prose ul,.uwa-prose ol{margin:0 0 10px;padding-left:22px}",
      ".uwa-prose li{margin:3px 0}",
      ".uwa-prose a{color:var(--color-brand,#c13030);font-weight:700;text-decoration:underline;text-underline-offset:2px}",
      ".uwa-prose blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid var(--color-brand,#c13030);background:var(--color-brand-dim,rgba(193,48,48,0.08));border-radius:0 10px 10px 0}",
      ".uwa-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}",
      ".uwa-linkbtn{display:inline-flex;align-items:center;gap:6px;font:700 12px Montserrat,system-ui,sans-serif;color:var(--color-ink-soft,#555);background:#fff;border:0.5px solid var(--color-line,rgba(0,0,0,0.09));border-radius:10px;padding:8px 12px;text-decoration:none}",
      ".uwa-linkbtn:hover{border-color:var(--color-brand,#c13030);color:var(--color-brand,#c13030)}",
    ].join("\n");
    var el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  window.UWAcademy = {
    escapeHtml: escapeHtml,
    sanitizeHtml: sanitizeHtml,
    detectVideo: detectVideo,
    videoEmbedHtml: videoEmbedHtml,
    toArr: toArr,
    sortModules: sortModules,
    sortLessons: sortLessons,
    computeAccess: computeAccess,
    lessonBodyHtml: lessonBodyHtml,
    injectBaseCss: injectBaseCss,
  };
})();
