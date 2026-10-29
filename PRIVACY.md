# MRFlow privacy policy

MRFlow is a browser extension that adds a Kanban board, badges and an approval checklist to GitLab merge request pages on gitlab.com.

## What MRFlow reads

- The GitLab merge request pages you open on gitlab.com.
- Details of the merge requests on those pages (approvals, threads, comments, merge status), read from the GitLab API of gitlab.com with your existing GitLab session.

## Where it keeps data

Only in your browser:

- Settings, in the extension's sync storage. If you sign in to your browser, the browser syncs them between your devices.
- What you last saw on each merge request (commit, number of comments) and the state of your approval checklist, in gitlab.com's local storage in your browser. Records not used for 30 days are deleted.

## What MRFlow sends

Nothing. It makes requests only to the GitLab instance of the page you are on, as you would yourself, and sends no data to the developer or to anyone else. It has no analytics, no tracking and no ads, and it loads no remote code.

## Contact

Questions: open an issue at https://github.com/Ravenen/mr-utils/issues.
