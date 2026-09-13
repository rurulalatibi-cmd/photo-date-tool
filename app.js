(function () {
  "use strict";

  var photos = [];
  var nextId = 1;

  var GATE_PASSWORD = "ruru0320";
  var GATE_SESSION_KEY = "photoToolAuthed";

  var gateOverlay = document.getElementById("gateOverlay");
  var gateForm = document.getElementById("gateForm");
  var gatePassword = document.getElementById("gatePassword");
  var gateError = document.getElementById("gateError");
  var homeView = document.getElementById("homeView");
  var toolView = document.getElementById("toolView");
  var startBtn = document.getElementById("startBtn");
  var backHomeBtn = document.getElementById("backHomeBtn");

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("fileInput");
  var photoList = document.getElementById("photoList");
  var reviewGuide = document.getElementById("reviewGuide");
  var bulkPanel = document.getElementById("bulkPanel");
  var bulkDateTime = document.getElementById("bulkDateTime");
  var bulkApplyBtn = document.getElementById("bulkApplyBtn");
  var selectAllBtn = document.getElementById("selectAllBtn");
  var selectNoneBtn = document.getElementById("selectNoneBtn");
  var selectedCountHint = document.getElementById("selectedCountHint");

  // --- Password gate ---------------------------------------------------
  // Client-side only: this keeps casual visitors out but is NOT real
  // security (the password is visible in the page source to anyone who
  // looks). Don't rely on it to protect anything sensitive.
  function showGated() {
    var authed = false;
    try {
      authed = sessionStorage.getItem(GATE_SESSION_KEY) === "1";
    } catch (err) {
      authed = false;
    }
    if (authed) {
      gateOverlay.hidden = true;
      homeView.hidden = false;
    } else {
      gateOverlay.hidden = false;
      homeView.hidden = true;
    }
    toolView.hidden = true;
  }

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (gatePassword.value === GATE_PASSWORD) {
      try {
        sessionStorage.setItem(GATE_SESSION_KEY, "1");
      } catch (err) {
        // ignore storage failures (e.g. private mode quota); still proceed.
      }
      gateError.hidden = true;
      gateOverlay.hidden = true;
      homeView.hidden = false;
    } else {
      gateError.hidden = false;
      gatePassword.value = "";
      gatePassword.focus();
    }
  });

  startBtn.addEventListener("click", function () {
    homeView.hidden = true;
    toolView.hidden = false;
  });

  // Reloading (rather than just toggling views) clears any loaded photos and
  // re-fetches the page over the network. This matters for the "Add to Home
  // Screen" shortcut: iOS often keeps that page alive in memory across app
  // switches instead of reloading it, so without this, going back to the
  // home screen would keep showing whatever was loaded before — including
  // stale code from before an update.
  backHomeBtn.addEventListener("click", function () {
    window.location.href = window.location.pathname + "?t=" + Date.now();
  });

  showGated();

  fileInput.addEventListener("change", function (e) {
    addFiles(e.target.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  });

  function selectedSupportedPhotos() {
    return photos.filter(function (p) { return p.supported && p.selected; });
  }

  selectAllBtn.addEventListener("click", function () {
    photos.forEach(function (p) { if (p.supported) p.selected = true; });
    renderPhotoList();
  });

  selectNoneBtn.addEventListener("click", function () {
    photos.forEach(function (p) { if (p.supported) p.selected = false; });
    renderPhotoList();
  });

  bulkApplyBtn.addEventListener("click", function () {
    var value = bulkDateTime.value;
    if (!value) {
      alert("日時を入力してください。");
      return;
    }
    var exifDate = localInputValueToExifDate(value);
    var selected = selectedSupportedPhotos();
    if (selected.length === 0) {
      alert("対象の写真が選択されていません。");
      return;
    }
    var entries = [];
    selected.forEach(function (photo) {
      var statusEl = document.getElementById("status-" + photo.id);
      try {
        var newDataURL = buildDateEditedDataURL(photo, exifDate);
        setCompareResult(photo, newDataURL, exifDate);
        entries.push({ dataURL: newDataURL, filename: suffixedName(photo.name, "date_edited"), statusEl: statusEl });
      } catch (err) {
        setStatus(statusEl, "更新に失敗しました: " + err.message, "error");
      }
    });
    // Do NOT show a blocking alert()/confirm() here: on iOS Safari the share
    // sheet (navigator.share) can only open while the tap's "transient user
    // activation" is still alive, and a modal dialog consumes it. Showing an
    // alert before saveFiles() is exactly why bulk saving failed. Report the
    // result through the (non-blocking) per-photo status line instead.
    if (entries.length > 0) {
      entries.forEach(function (e) {
        setStatus(e.statusEl, "撮影日時を " + formatDisplayDate(exifDate) + " に変更しました。保存中...", "ok");
      });
    }
    saveFiles(entries);
  });

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (files.length === 0) return;

    files.forEach(function (file) {
      var photo = {
        id: nextId++,
        file: file,
        name: file.name,
        dataURL: null,
        supported: false,
        selected: true,
        error: null
      };
      photos.push(photo);

      var reader = new FileReader();
      reader.onload = function () {
        photo.dataURL = reader.result;
        try {
          var isJpeg = photo.dataURL.indexOf("data:image/jpeg;base64,") === 0 ||
            photo.dataURL.indexOf("data:image/jpg;base64,") === 0;
          var isPng = photo.dataURL.indexOf("data:image/png;base64,") === 0;
          if (isJpeg) {
            photo.format = "jpeg";
            photo.exifDict = piexif.load(photo.dataURL);
          } else if (isPng) {
            photo.format = "png";
            photo.exifDict = readPngExifDict(photo.dataURL);
          } else {
            throw new Error("unsupported-format");
          }
          photo.supported = true;
          photo.originalDateString = currentExifDateString(photo);
        } catch (err) {
          photo.supported = false;
          photo.error = "JPEG・PNG以外の形式では処理できません（HEICなど）。iPhoneの「設定 > カメラ > フォーマット」を「互換性優先」にするか、共有時にJPEGとして書き出してから読み込んでください。";
        }
        renderPhotoList();
      };
      reader.onerror = function () {
        photo.supported = false;
        photo.error = "ファイルの読み込みに失敗しました。";
        renderPhotoList();
      };
      reader.readAsDataURL(file);
    });

    renderPhotoList();
  }

  function currentExifDateString(photo) {
    if (!photo.exifDict) return null;
    var exifIfd = photo.exifDict["Exif"] || {};
    var zerothIfd = photo.exifDict["0th"] || {};
    return exifIfd[piexif.ExifIFD.DateTimeOriginal] ||
      exifIfd[piexif.ExifIFD.DateTimeDigitized] ||
      zerothIfd[piexif.ImageIFD.DateTime] ||
      null;
  }

  function exifDateToLocalInputValue(exifDateStr) {
    // "YYYY:MM:DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
    var m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(exifDateStr || "");
    if (!m) return "";
    return m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6];
  }

  function localInputValueToExifDate(value) {
    // "YYYY-MM-DDTHH:MM:SS" (or without seconds) -> "YYYY:MM:DD HH:MM:SS"
    var parts = value.split("T");
    var datePart = parts[0].split("-").join(":");
    var timePart = parts[1] || "00:00:00";
    if (timePart.split(":").length === 2) {
      timePart += ":00";
    }
    return datePart + " " + timePart;
  }

  function dataURLtoBlob(dataURL) {
    var arr = dataURL.split(",");
    var mimeMatch = arr[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  function suffixedName(name, suffix) {
    var dot = name.lastIndexOf(".");
    if (dot === -1) return name + "_" + suffix;
    return name.slice(0, dot) + "_" + suffix + name.slice(dot);
  }

  function setStatus(statusEl, text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  // Safari (particularly iOS/Private Browsing) frequently ignores the
  // <a download> attribute on blob: URLs and just navigates to the blob,
  // which breaks the app. The Web Share API sidesteps that entirely by
  // handing the file to the native share sheet, so prefer it when available.
  function canShareFiles(files) {
    try {
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: files }));
    } catch (err) {
      return false;
    }
  }

  function dataURLtoFile(dataURL, filename) {
    var blob = dataURLtoBlob(dataURL);
    return new File([blob], filename, { type: blob.type });
  }

  function downloadViaAnchor(dataURL, filename) {
    var blob = dataURLtoBlob(dataURL);
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // If the browser ignores `download` and navigates instead, open a new
    // tab rather than destroying this page's state.
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function saveFile(dataURL, filename, statusEl) {
    saveFiles([{ dataURL: dataURL, filename: filename, statusEl: statusEl }]);
  }

  function saveFiles(entries) {
    if (entries.length === 0) return;
    var files = entries.map(function (e) { return dataURLtoFile(e.dataURL, e.filename); });

    if (canShareFiles(files)) {
      navigator.share({ files: files }).then(function () {
        entries.forEach(function (e) {
          setStatus(e.statusEl, "共有シートが開いたら「画像を保存」をタップすると、iPhoneの「フォト」に直接保存されます。", "ok");
        });
        promptToOpenPhotosForCleanup();
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        entries.forEach(function (e) {
          downloadViaAnchor(e.dataURL, e.filename);
          setStatus(e.statusEl, "ダウンロードしました。", "ok");
        });
      });
    } else {
      entries.forEach(function (e, index) {
        setTimeout(function () {
          downloadViaAnchor(e.dataURL, e.filename);
          setStatus(e.statusEl, "ダウンロードしました。", "ok");
        }, index * 250);
      });
    }
  }

  // The Web Share API never tells us which share target the user picked
  // (Save Image, AirDrop, cancel, ...), only that the sheet closed without
  // error. We can't detect or perform the actual deletion — iOS gives web
  // pages no API for that — so this just asks, and if they confirm, jumps
  // straight to the Photos app via an Apple-internal (undocumented) URL
  // scheme so there's one less thing for them to go find themselves.
  function promptToOpenPhotosForCleanup() {
    var wantsToOpenPhotos = confirm(
      "保存が完了しました。今すぐ「フォト」アプリを開いて、元の写真を削除しますか？\n" +
      "（比較表示の「編集前」の写真と同じものを探して削除してください）"
    );
    if (wantsToOpenPhotos) {
      window.location.href = "photos-redirect://";
    }
  }

  function applyDateFieldsToExifDict(exifDict, exifDateStr) {
    exifDict["0th"] = exifDict["0th"] || {};
    exifDict["Exif"] = exifDict["Exif"] || {};
    exifDict["0th"][piexif.ImageIFD.DateTime] = exifDateStr;
    exifDict["Exif"][piexif.ExifIFD.DateTimeOriginal] = exifDateStr;
    exifDict["Exif"][piexif.ExifIFD.DateTimeDigitized] = exifDateStr;
    return exifDict;
  }

  function buildDateEditedDataURL(photo, exifDateStr) {
    if (photo.format === "png") {
      return buildPngDateEditedDataURL(photo, exifDateStr);
    }
    var exifDict = applyDateFieldsToExifDict(photo.exifDict, exifDateStr);
    var exifBytes = piexif.dump(exifDict);
    return piexif.insert(exifBytes, photo.dataURL);
  }

  // ---- PNG EXIF support -------------------------------------------------
  // piexifjs only understands JPEG's APP1 segment. PNG stores EXIF in its
  // own "eXIf" chunk, holding the same raw TIFF bytes but WITHOUT the
  // 6-byte "Exif\0\0" prefix JPEG uses. So: fake that prefix on read (to
  // reuse piexif's TIFF parser) and strip it back off on write.

  var PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";
  var CRC_TABLE = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(str) {
    var crc = 0xffffffff;
    for (var i = 0; i < str.length; i++) {
      crc = CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function readUint32BE(str, offset) {
    return ((str.charCodeAt(offset) << 24) |
      (str.charCodeAt(offset + 1) << 16) |
      (str.charCodeAt(offset + 2) << 8) |
      str.charCodeAt(offset + 3)) >>> 0;
  }

  function writeUint32BE(n) {
    return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }

  function parsePngChunks(bin) {
    var pos = 8; // skip the 8-byte PNG signature
    var chunks = [];
    while (pos < bin.length) {
      var length = readUint32BE(bin, pos);
      var type = bin.substr(pos + 4, 4);
      var data = bin.substr(pos + 8, length);
      chunks.push({ type: type, data: data });
      pos += 12 + length; // length(4) + type(4) + data + crc(4)
      if (type === "IEND") break;
    }
    return chunks;
  }

  function serializePngChunks(chunks) {
    var out = PNG_SIGNATURE;
    for (var i = 0; i < chunks.length; i++) {
      var type = chunks[i].type;
      var data = chunks[i].data;
      out += writeUint32BE(data.length) + type + data + writeUint32BE(crc32(type + data));
    }
    return out;
  }

  function dataURLtoBinaryString(dataURL) {
    return atob(dataURL.split(",")[1]);
  }

  function binaryStringToDataURL(bin, mime) {
    return "data:" + mime + ";base64," + btoa(bin);
  }

  function readPngExifDict(dataURL) {
    var emptyDict = { "0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": null };
    var chunks = parsePngChunks(dataURLtoBinaryString(dataURL));
    var exifChunk = null;
    for (var i = 0; i < chunks.length; i++) {
      if (chunks[i].type === "eXIf") { exifChunk = chunks[i]; break; }
    }
    if (!exifChunk) return emptyDict;
    try {
      return piexif.load("Exif\x00\x00" + exifChunk.data);
    } catch (err) {
      return emptyDict;
    }
  }

  function replacePngExifChunk(dataURL, tiffBytes) {
    var chunks = parsePngChunks(dataURLtoBinaryString(dataURL));
    chunks = chunks.filter(function (c) { return c.type !== "eXIf"; });
    var ihdrIndex = 0;
    for (var i = 0; i < chunks.length; i++) {
      if (chunks[i].type === "IHDR") { ihdrIndex = i; break; }
    }
    chunks.splice(ihdrIndex + 1, 0, { type: "eXIf", data: tiffBytes });
    return binaryStringToDataURL(serializePngChunks(chunks), "image/png");
  }

  function buildPngDateEditedDataURL(photo, exifDateStr) {
    var exifDict = applyDateFieldsToExifDict(photo.exifDict, exifDateStr);
    var exifBytesWithPrefix = piexif.dump(exifDict);
    var tiffBytes = exifBytesWithPrefix.slice(6); // drop the "Exif\0\0" prefix
    return replacePngExifChunk(photo.dataURL, tiffBytes);
  }

  function formatDisplayDate(exifDateStr) {
    if (!exifDateStr) return null;
    return exifDateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1/$2/$3");
  }

  function setCompareResult(photo, afterDataURL, afterExifDateStr) {
    photo.compareResult = { afterDataURL: afterDataURL, afterExifDateStr: afterExifDateStr };
    renderReviewGuide();
  }

  // ---- Delete guide -----------------------------------------------------
  // A consolidated "review & delete" panel that gathers every saved photo in
  // one place so the user can walk through deleting the originals. iOS gives
  // web pages no way to delete from or even read the Photos library, so we
  // can't do it for them or verify the saved copy exists — instead we lead
  // them: show the original (to delete) next to the saved copy (to keep),
  // point them to the date where each now lives in the Photos timeline, and
  // track progress so they can confirm all of them together.

  function buildReviewCol(kind, label, dataURL, dateText) {
    var col = document.createElement("div");
    col.className = "review-col " + kind;
    var labelEl = document.createElement("div");
    labelEl.className = "review-col-label";
    labelEl.textContent = label;
    col.appendChild(labelEl);
    var img = document.createElement("img");
    img.src = dataURL;
    col.appendChild(img);
    var dateEl = document.createElement("div");
    dateEl.className = "review-col-date";
    dateEl.textContent = dateText;
    col.appendChild(dateEl);
    return col;
  }

  function buildReviewCard(photo, num) {
    var card = document.createElement("div");
    card.className = "review-card" + (photo.originalDeleted ? " done" : "");

    var numBadge = document.createElement("div");
    numBadge.className = "review-num";
    numBadge.textContent = photo.originalDeleted ? "✓" : String(num);
    card.appendChild(numBadge);

    var body = document.createElement("div");
    body.className = "review-body";

    var cmp = document.createElement("div");
    cmp.className = "review-compare";
    cmp.appendChild(buildReviewCol(
      "delete",
      "❌ これが元の写真（削除する）",
      photo.dataURL,
      formatDisplayDate(photo.originalDateString) || "日時情報なし"
    ));
    cmp.appendChild(buildReviewCol(
      "keep",
      "✅ 保存した写真（残す）",
      photo.compareResult.afterDataURL,
      formatDisplayDate(photo.compareResult.afterExifDateStr) || ""
    ));
    body.appendChild(cmp);

    var oldD = formatDisplayDate(photo.originalDateString);
    var newD = formatDisplayDate(photo.compareResult.afterExifDateStr);
    var hint = document.createElement("p");
    hint.className = "review-hint";
    if (oldD && newD) {
      hint.innerHTML = "「フォト」で <strong>" + oldD + "</strong> のあたりを開くと、左の元の写真が見つかります。" +
        "編集後の写真は <strong>" + newD + "</strong> に移動しています。左とまったく同じ見た目の写真だけを削除してください。";
    } else {
      hint.textContent = "「フォト」で左の元の写真と同じ見た目の写真を探して削除してください。編集後の写真（右）はフォトに保存されています。";
    }
    body.appendChild(hint);

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "review-toggle" + (photo.originalDeleted ? " done secondary" : "");
    toggle.textContent = photo.originalDeleted ? "✓ 削除済み（取り消す）" : "元の写真を削除した";
    toggle.addEventListener("click", function () {
      photo.originalDeleted = !photo.originalDeleted;
      renderReviewGuide();
    });
    body.appendChild(toggle);

    card.appendChild(body);
    return card;
  }

  function renderReviewGuide() {
    if (!reviewGuide) return;
    var saved = photos.filter(function (p) { return p.compareResult; });
    reviewGuide.innerHTML = "";
    if (saved.length === 0) {
      reviewGuide.hidden = true;
      return;
    }
    reviewGuide.hidden = false;

    var doneCount = saved.filter(function (p) { return p.originalDeleted; }).length;
    var allDone = doneCount === saved.length;

    var head = document.createElement("div");
    head.className = "review-head";

    var title = document.createElement("h2");
    title.textContent = allDone
      ? "🎉 元の写真をすべて削除しました"
      : "元の写真を削除しましょう";
    head.appendChild(title);

    var lead = document.createElement("p");
    lead.className = "review-lead";
    lead.textContent = allDone
      ? "お疲れさまでした。編集後の写真だけがフォトに残っています。"
      : "保存した写真ごとに、どれが元の写真かを表示します。フォトで削除できたら「削除した」を押してください。";
    head.appendChild(lead);

    var progressText = document.createElement("p");
    progressText.className = "review-progress-text";
    progressText.textContent = doneCount + " / " + saved.length + " 枚 削除済み";
    head.appendChild(progressText);

    var bar = document.createElement("div");
    bar.className = "review-bar";
    var fill = document.createElement("div");
    fill.className = "review-bar-fill";
    fill.style.width = Math.round(doneCount / saved.length * 100) + "%";
    bar.appendChild(fill);
    head.appendChild(bar);

    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "review-open-photos";
    openBtn.textContent = "「フォト」アプリを開く";
    openBtn.addEventListener("click", function () {
      window.location.href = "photos-redirect://";
    });
    head.appendChild(openBtn);

    reviewGuide.appendChild(head);

    saved.forEach(function (photo, idx) {
      reviewGuide.appendChild(buildReviewCard(photo, idx + 1));
    });
  }

  function applyDateAndDownload(photo, exifDateStr) {
    var statusEl = document.getElementById("status-" + photo.id);
    try {
      var newDataURL = buildDateEditedDataURL(photo, exifDateStr);
      setCompareResult(photo, newDataURL, exifDateStr);
      // No blocking alert() before saving: it consumes the tap's user
      // activation and stops iOS Safari's share sheet from opening. The
      // before/after comparison panel already shows the date change.
      setStatus(statusEl, "撮影日時を " + formatDisplayDate(exifDateStr) + " に変更しました。保存中...", "ok");
      saveFile(newDataURL, suffixedName(photo.name, "date_edited"), statusEl);
    } catch (err) {
      setStatus(statusEl, "更新に失敗しました: " + err.message, "error");
    }
  }

  function renderPhotoList() {
    var supportedPhotos = photos.filter(function (p) { return p.supported; });
    bulkPanel.hidden = supportedPhotos.length === 0;
    var selectedCount = supportedPhotos.filter(function (p) { return p.selected; }).length;
    selectedCountHint.textContent = supportedPhotos.length
      ? selectedCount + " / " + supportedPhotos.length + " 枚を選択中"
      : "";

    photoList.innerHTML = "";
    photos.forEach(function (photo) {
      var card = document.createElement("div");
      card.className = "photo-card" + (photo.supported ? "" : " unsupported");

      var img = document.createElement("img");
      if (photo.dataURL) img.src = photo.dataURL;
      card.appendChild(img);

      var info = document.createElement("div");

      if (!photo.supported) {
        var nameEl0 = document.createElement("div");
        nameEl0.className = "name";
        nameEl0.textContent = photo.name;
        info.appendChild(nameEl0);
        var errEl = document.createElement("div");
        errEl.className = "status error";
        errEl.textContent = photo.error || "読み込み中...";
        info.appendChild(errEl);
        card.appendChild(info);
        photoList.appendChild(card);
        return;
      }

      var nameRow = document.createElement("div");
      nameRow.className = "name-row";
      var selectLabel = document.createElement("label");
      selectLabel.className = "select-check";
      var selectCheckbox = document.createElement("input");
      selectCheckbox.type = "checkbox";
      selectCheckbox.checked = !!photo.selected;
      selectCheckbox.setAttribute("aria-label", "一括操作の対象にする");
      selectCheckbox.addEventListener("change", function () {
        photo.selected = selectCheckbox.checked;
        var supportedPhotos = photos.filter(function (p) { return p.supported; });
        var selectedCount = supportedPhotos.filter(function (p) { return p.selected; }).length;
        selectedCountHint.textContent = selectedCount + " / " + supportedPhotos.length + " 枚を選択中";
      });
      selectLabel.appendChild(selectCheckbox);
      nameRow.appendChild(selectLabel);

      var nameEl = document.createElement("div");
      nameEl.className = "name";
      nameEl.textContent = photo.name;
      nameRow.appendChild(nameEl);
      info.appendChild(nameRow);

      var currentDate = currentExifDateString(photo);
      var dateInfoEl = document.createElement("div");
      dateInfoEl.className = "current-date";
      dateInfoEl.textContent = currentDate
        ? "現在の撮影日時: " + currentDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1/$2/$3")
        : "現在の撮影日時: 情報なし";
      info.appendChild(dateInfoEl);

      var row = document.createElement("div");
      row.className = "row";

      var dateInput = document.createElement("input");
      dateInput.type = "datetime-local";
      dateInput.step = "1";
      dateInput.value = currentDate ? exifDateToLocalInputValue(currentDate) : "";
      row.appendChild(dateInput);

      var updateBtn = document.createElement("button");
      updateBtn.type = "button";
      updateBtn.textContent = "この日時に更新してダウンロード";
      updateBtn.addEventListener("click", function () {
        if (!dateInput.value) {
          alert("日時を入力してください。");
          return;
        }
        applyDateAndDownload(photo, localInputValueToExifDate(dateInput.value));
      });
      row.appendChild(updateBtn);

      info.appendChild(row);

      var statusEl = document.createElement("div");
      statusEl.className = "status";
      statusEl.id = "status-" + photo.id;
      info.appendChild(statusEl);

      card.appendChild(info);
      photoList.appendChild(card);
    });

    // The before/after review of already-saved photos lives in its own
    // consolidated "delete guide" section, not inside each list card.
    renderReviewGuide();
  }
})();
