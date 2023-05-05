# reddit-save

A simple script that saves Reddit post content.

> **Note**:
>
> - Has only been tested on Windows (11) so far.
> - The code is messy and inefficient. Not particularly going for quality here, just kind of getting it done before Imgur pulls a Tumblr on us on May 15, 2023.
> - The script is opinionated. You may have to tinker with the code a bit, if the default behavior doesn't appeal to you.
> - Updates might come, with more functionality and improved code quality, and added customizability.

## Prerequisites

- Reddit Data
    1. Request your data from Reddit (GPDR) [here](https://www.reddit.com/settings/data-request). This might take a while, so it's recommended to do this in advance.
    2. Download the zip archive once the download is ready.
    3. Extract the zip archive and copy that folder into the root of this project.
    4. Rename the folder to `data`.

- Reddit App
    1. Create a Reddit app [here](https://www.reddit.com/prefs/apps/). It should be a `personal use script`. The redirect URI doesn't matter; it can be set to anything. However, you'll have to come back to this page in the next (Config) prerequisite though, to get your client ID and client secret, and to generate your refresh token. To get your refresh token, you'll need to change the redirect URI. So, just change it now instead.
    2. Set your Reddit app's redirect URI to `https://not-an-aardvark.github.io/reddit-oauth-helper/`.
    3. Make note of your Reddit app's client ID and client secret. You'll need them in the next (Config) prerequisite.

- Config
    1. Run the script once to generate the default config: `npm start`.
    2. Set `REDDIT_USERNAME` to your Reddit username, in the `.env` file.
    3. Set `REDDIT_CLIENT_ID` to your Reddit app's client ID, in the `.env` file.
    4. Set `REDDIT_CLIENT_SECRET` to your Reddit app's client secret, in the `.env` file.
    5. Ensure your Reddit app's redirect URI is set to `https://not-an-aardvark.github.io/reddit-oauth-helper/`. This is a tool that helps you generate a refresh token.
    6. Head over [here](https://not-an-aardvark.github.io/reddit-oauth-helper/) in your browser
    7. Under "Generate Token", input your client ID and client secret.
    8. Check the "Permanent?" box, or leave it blank and it will expire in an hour. You can manually revoke tokens when you're done with them by sending a request to `https://www.reddit.com/api/v1/revoke_token` (see the [Wiki](https://github.com/reddit-archive/reddit/wiki/OAuth2#manually-revoking-a-token) for more), or by visiting the installed apps page [here](https://www.reddit.com/prefs/apps/).
    9. Check all the scope boxes. The script really only requires the `read` scope, but you can check all of the boxes to reduce the risk of any errors.
    10. Click the "Generate Token" button.
    11. Copy, then set `REDDIT_REFRESH_TOKEN` to your generated refresh token, in the `.env` file.

- Gallery-dl (used for downloading media content)
    1. Download the appropriate `gallery-dl` binary for your system [here](https://github.com/mikf/gallery-dl/releases), and place it in the root of this project. Alternatively, you can install it with `pip install -U gallery-dl`, if you have Python 3 installed.
    2. Rename the binary to `gallery-dl` (or `gallery-dl.exe` on Windows), if necessary.
    3. Run `gallery-dl oauth:reddit` and follow the instructions on the opened webpage to authenticate your Reddit account with gallery-dl.

## Usage

> **Note**:
> Edit the `Main` or `DownloadAll` function in `index.ts` to change the default behavior (for example, only download posts) to your liking.

1. Install dependencies: `npm install`.
2. Prepare your Reddit data, as described in the prerequisites.
3. Prepare your Reddit app, as described in the prerequisites.
4. Prepare your config, as described in the prerequisites.
5. Prepare gallery-dl, as described in the prerequisites.
6. Run the script: `npm start`. If there any failed downloads at the end in `failed.csv`, retry them like this: `DownloadAll('posts/failed.csv')`. This does work sometimes for posts that didn't download the first time. Otherwise, they may have been deleted or removed, or the script may have failed to download them for some other reason.

By default, the script will save all posts to the `posts` folder, organized with subdirectories for subreddits. Basic information will be saved to `post.json`, in the post's specific directory. A thumbnail will also be saved, if available.

## Next

The script saves enough information for compatibility with any future projects or updates.

It's possible I might create (if I get bored) a viewer part to this project in the future, that can display the saved content in a nice way. I might also add the ability to make custom post lists, since Reddit only has the saved posts list which is limited to 1000 posts.

## License

At the moment, this project is not licensed. All rights reserved.
