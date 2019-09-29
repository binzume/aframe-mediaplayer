"use strict";

// <script src="googledrive.js"></script>
// <script src="https://apis.google.com/js/api.js?onload=gapiLoaded" async defer></script>

class GoogleDrive {
    constructor(clientId) {
        this.params = {
            'client_id': clientId,
            'scope': 'https://www.googleapis.com/auth/drive'
        };
    }
    async init(signIn = true) {
        await new Promise((resolve, _) => gapi.load('client:auth2', resolve));
        let auth = await gapi.auth2.init(this.params);
        if (!auth.isSignedIn.get()) {
            if (!signIn) return false;
            await auth.signIn();
        }
        await gapi.client.load("drive", "v3");
        return true;
    }
    signOut() {
        gapi.auth2.getAuthInstance().signOut();
    }
    async getFiles(folder, limit, pageToken, options) {
        options = options || {};
        // kind, webViewLink
        let response = await gapi.client.drive.files.list({
            fields: "nextPageToken, files(id, name, size, mimeType, modifiedTime, iconLink, thumbnailLink)",
            orderBy: options.orderBy || "modifiedTime desc",
            q: "trashed=false and '" + (folder || 'root') + "' in parents",
            pageSize: limit || 50,
            pageToken: pageToken,
            spaces: "drive"
        });
        if (!response || response.status != 200) {
            return null;
        }
        // application/vnd.google-apps.folder
        return response.result;
    }
    async getFile(fileId) {
        let response = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });
        if (!response || response.status != 200) {
            return null;
        }
        return response.body;
    }
    async create(name, content, mimeType, folder) {
        return await gapi.client.drive.files.create({
            name: name,
            parents: [folder || 'root'],
            uploadType: "media",
            fields: "id, name, parents",
            media: content,
            resource: { mimeType: mimeType }
        });
    }
    async delete(fileId) {
        return await gapi.client.drive.files.delete({
            fileId: fileId
        }).status == 204;
    }
    async getFileBlob(fileId) {
        let url = "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media";
        let headers = {'Authorization': 'Bearer ' + gapi.auth.getToken().access_token};
        let response = await fetch(url, {headers: new Headers(headers)});
        if (!response.ok) throw new Error(response.statusText);
        return await response.blob();
    }
}

class FileList {
    constructor(folder, options, drive) {
        this.itemPath = folder;
        this.options = options || {};
        this.size = -1;
        this.name = "";
        this.thumbnailUrl = null;

        this.drive = drive;
        this.cursor = null;
        this.offset = 0;
        this.loadPromise = null;
        this.driveOption = {};
        this.items = [];
        if (this.options.orderBy == "name") {
            this.driveOption.orderBy = "name" + (this.options.order == "d" ? " desc" : "");
        } else if (this.options.orderBy == "updated") {
            this.driveOption.orderBy = "modifiedTime" + (this.options.order == "d" ? " desc" : "");
        }
    }
    async init() {
        await this._load();
    }
    async get(position) {
        let item = this._getOrNull(position);
        if (item != null) {
            return item;
        }
        if (position < 0 || this.size >= 0 && position >= this.size) throw "Out of Range error.";
        await this._load();
        return this._getOrNull(position);
    }
    async _load() {
        if (this.loadPromise !== null) return await this.loadPromise;
        this.loadPromise = (async () => {
            let result = await this.drive.getFiles(this.itemPath, 200, this.cursor, this.driveOption);
            this.cursor = result.nextPageToken;
            let files = result.files.map(f => ({
                contentType: f.mimeType == "application/vnd.google-apps.folder" ? "directory" : f.mimeType,
                duration: 0,
                id: f.id,
                path: f.id,
                name: f.name,
                size: f.size,
                tags: [this.itemPath],
                thumbnailUrl: (f.thumbnailLink && !f.thumbnailLink.startsWith("https://docs.google.com/")) ? f.thumbnailLink : null,
                updatedTime: f.modifiedTime,
                url: (f.thumbnailLink) ? f.thumbnailLink.replace(/=s\d+/, "=s2048") : null,
            }));
            this.items = this.items.concat(files);

            this.size = this.items.length + (this.cursor ? 1 : 0);
            if (!this.thumbnailUrl && files[0]) this.thumbnailUrl = files[0].thumbnailUrl;
        })();
        try {
            await this.loadPromise;
        } finally {
            this.loadPromise = null;
        }
    }
    _getOrNull(position) {
        if (position < this.offset || position >= this.offset + this.items.length) return null;
        return this.items[position - this.offset];
    }
}

async function gapiLoaded() {
    window.storageAccessors = window.storageAccessors || {};
    const clientIds = {
        "http://localhost:8080": "86954684848-e879qasd2bnnr4pcdiviu68q423gbq4m.apps.googleusercontent.com",
        "https://binzume.github.io": "86954684848-okobt1r6kedh2cskabcgmbbqe0baphjb.apps.googleusercontent.com"
    };
    let drive = new GoogleDrive(clientIds[location.origin]);
    if (!await drive.init(false)) {
        console.log("drive unavailable");
        return;
    }

    storageAccessors["GoogleDrive"] = {
        name: "Google Drive",
        root: 'root',
        shortcuts: [],
        getList: (folder, options) => new FileList(folder, options, drive)
    };
}
