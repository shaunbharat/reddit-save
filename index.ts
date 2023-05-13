import snoowrap from 'snoowrap';
import { parse } from 'csv/sync';
import { Writer } from 'steno';
import axios from 'axios';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import readline from 'node:readline';
import module from 'node:module';
const require = module.createRequire(import.meta.url); // loading JSON files with require()
const { version, description } = require('./package.json');

// todo:
// - graceful shutdown, sigint, sigterm, sigkill, etc??? (ctrl-c)?
// - process.uptime() in progress bar, minus timestamp when started downloads
// todo: add support for multiple inputs (multiple: true, then loop through the array of files or folders and asynchronously? download them)

// Parse arguments

// Quotes are used to escape hyphens in paths
const { values: options, positionals: [input] } = parseArgs({
    options: {
        'output-directory': {
            type: 'string',
            short: 'o',
            default: 'posts',
        },
        'skip-authentication': {
            type: 'boolean',
            short: 'S',
            default: false,
        },
        'verbose': {
            type: 'boolean',
            short: 'v',
            default: false,
        },
        // todo:
        'skip-existing': {
            type: 'boolean',
            short: 'e',
            default: false,
        },
        // todo:
        'resume': {
            type: 'boolean',
            short: 'r',
            default: false,
        },
        'nsfw-only': {
            type: 'boolean',
            short: 'N',
            default: false,
        },
        'media-only': {
            type: 'boolean',
            short: 'M',
            default: false,
        },
        'save-deleted': {
            type: 'boolean',
            short: 'D',
            default: false,
        },
        // todo:
        'save-everything': {
            type: 'boolean',
            short: 'E',
            default: false,
        },
    },
    allowPositionals: true,
});

// description: ${description}
// version: ${version}
// usage: reddit-save <file> [options]
// file: The input CSV file of Reddit posts to download (id,permalink) (or where the first column is the ID and the rest are any). (required)
if (!input) {
    console.error(`${description}
v${version}

    Usage: npm start -- <file> [options]

    Arguments:
        file: The input CSV file of Reddit posts to download. The first column should have a post ID.

    Options:
        -o, --output-directory: The output folder to download the posts to. The folder structure is not customizable at this time.
        -S, --skip-authentication: If gallery-dl is already authenticated with Reddit, this can be set to true to skip the authentication process.
        -v, --verbose: The script will log each post's status, above the progress bar.
            (not implemented yet) -e, --skip-existing: Only missing posts will be downloaded. It skips downloading a post if the directory already exists inside the given ouput directory.
            (not implemented yet) -r, --resume: Starts script from where it left off, if it was previously stopped by Ctrl-C (graceful termination).
        -N, --nsfw-only: Only NSFW posts will be downloaded. The script will check if a post is marked as NSFW before downloading it.
        -M, --media-only: No post data will be saved. Post media (images, videos, etc.) will be downloaded to the 'content' subfolder of the post's folder.
        -D, --save-deleted: Deleted posts will be saved. Only the post data of deleted posts will be saved, to the "deleted" subfolder of the output folder.
            (not implemented yet) -E, --save-everything: Almost all post information (text content, comments, crosspost information, awards, etc.) is saved. This script is mainly for downloading media, so this is disabled by default.

    Information:
        - The script will log each post as it is attempted to be downloaded (can be disabled with the silent flag). The following messages are possible:
            - 'Skipped.' means the post was deleted (comments and other information is still available).
            - 'Failed.' means the post was completely removed from Reddit.
            - 'Downloaded.', it means the post media content was downloaded, and the post information was saved.

        - Graceful Termination (Ctrl-C)
            - Ctrl-C can be used to stop the script at any time, but it will gracefully terminate instead, saving progress for resuming later.
            - Ctrl-C is useful, but there is currently no other way to pause execution. Events like a power outage or computer crash are not handled at this time.

        - Example: "npm start -- data/saved_posts.csv -S -v"
            * This downloads all posts from the CSV file "data/saved_posts.csv" to the default output folder, "posts".
            * '-S' skips gallery-dl Reddit authentication (assumes you already ran "gallery-dl oauth:reddit").
            * '-v' prints post status messages above the progress bar.
`);
    process.exit(1);
}

// Prerequisites

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clearLine = () => { process.stdout.clearLine(0); process.stdout.cursorTo(0); };
const clearPreviousLine = () => { process.stdout.moveCursor(0, -1); process.stdout.clearLine(0); };
const notMet = (text: string) => { clearLine(); process.stdout.write(chalk.red('    ✗ ') + text); };
const met = (text: string) => { clearLine(); process.stdout.write(chalk.green('    ✓ ') + text); };
const pending = (text: string) => { clearLine(); process.stdout.write(chalk.yellow('    ? ') + text); };
console.log('Checking prerequisites...\n');

async function checkConfig() {
    if (dotenv.config().error) {
        return false;
    }
    return true;
}

async function checkData() {
    if (!fs.existsSync(input)) return false; // non-null assertion operator because it's already checked above (prints usage and exits if it doesn't exist)
    return true;
}

async function checkGalleryDL() {
    try {
        const { stdout } = (await promisify(exec)(process.platform == 'win32' ? 'where gallery-dl' : 'which gallery-dl'));
        const gallery_dl = stdout.trim();
        if (!gallery_dl) return '';
        return gallery_dl;

    } catch (error) {
        return '';
    }
}

async function checkGalleryDLAuth() {
    if (options['skip-authentication']) return true;
    return await new Promise<boolean>((resolve, reject) => { // wrapped in a promise because you can't return from a callback
        try {
            exec(`${GALLERY_DL} oauth:reddit`, (error, stdout, stderr) => {
                // Runs after process is finished
                if (error || stderr) {
                    resolve(false);
                }
            }).stdout!.on('data', (data: string) => {
                // Runs after each line of output
                if (data.includes('http')) {
                    const url = data.substring(data.indexOf('http'), data.length - 1).split('\n')[0]; // Find the URL in the output and get the substring starting from 'http' to the end. Then get the first part before the next newline.
                    pending(`Allow gallery-dl to access your Reddit account:\n        ${url}`); // 8 spaces
                }
                if (data.includes("Your 'refresh-token' is")) {
                    resolve(true);
                }
            });
        } catch (error) {
            resolve(false);
        }
    });
}

// Perform and handle checks
let ready = true; // Will be set to false if any prerequisite isn't met

// Load .env file, or generate one if it doesn't exist
if (await checkConfig()) {
    met('.env file found!\n');
} else {
    ready = false;

    notMet('.env file not found.');
    await sleep(600); // Allow the user to see the message. Only sleeps if the .env file doesn't exist (usually corrected after the first run), so it's not an issue.
    notMet('Generating default config...');
    await sleep(1000);
    try {
        await new Writer('.env').write('REDDIT_USERNAME = ""\nREDDIT_CLIENT_ID = ""\nREDDIT_CLIENT_SECRET = ""\nREDDIT_REFRESH_TOKEN = ""\n');
        notMet('Generated default config. Please edit the .env file and run this script again.\n');
    } catch (error) {
        notMet('Failed. Please create a .env file with the following environment variables: "REDDIT_USERNAME", "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_REFRESH_TOKEN".\n');
    }
}
if (!process.env.REDDIT_USERNAME || !process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET || !process.env.REDDIT_REFRESH_TOKEN) {
    ready = false;

    notMet('Please edit the .env file and run this script again.\n');
}

if (await checkData()) {
    met('input file found!\n');
} else {
    ready = false;

    notMet('input file not found.\n');
}

const GALLERY_DL = await checkGalleryDL();
if (GALLERY_DL) {
    met('gallery-dl found!\n');
} else {
    ready = false;

    notMet('gallery-dl not found. Please download the binary from here: https://github.com/mikf/gallery-dl/releases (read README.md for more info).\n');
}

if (GALLERY_DL) {
    if (await checkGalleryDLAuth()) {
        clearLine();
        clearPreviousLine();
        met('gallery-dl authenticated with Reddit!\n');
    } else {
        ready = false;

        clearLine();
        clearPreviousLine();
        notMet('gallery-dl not authenticated with Reddit. Please run "gallery-dl oauth:reddit" and follow the instructions.\n');
    }
} else {
    clearLine();
    clearPreviousLine();
    notMet('Please download gallery-dl first. See the link above.\n');
}

if (!ready) {
    console.log('\nPlease read README.md and complete the prerequisities before continuing.');
    process.exit(1);
} else {
    console.log('\nAll prerequisites met. Continuing...\n');
    // Constants and Reddit client are initialized, and script continues below
};

// Initialize Reddit client
const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN;
const REDDIT_APP_NAME = 'reddit-save';
const USER_AGENT = `${process.platform}:${REDDIT_APP_NAME}:${version} (by /u/${REDDIT_USERNAME})`;

const reddit = new snoowrap({
    userAgent: USER_AGENT,
    clientId: REDDIT_CLIENT_ID,
    clientSecret: REDDIT_CLIENT_SECRET,
    username: REDDIT_USERNAME,
    refreshToken: REDDIT_REFRESH_TOKEN,
});

reddit.config({ continueAfterRatelimitError: true, warnings: false }); // warnings break progress bar

/**
 * GetLinks returns an array of post IDs from the given CSV file.
 * Comments (#) and empty lines are ignored.
 * It is assumed that the first column of the CSV file contains the post IDs,
 * and that the first line of the CSV file is a header.
 * @param filename - The CSV file to read from.
 */
async function getLinks(filename: string): Promise<string[]> {
    // todo: Resume from last post if the CSV file is the same as the last time the script was run
    let from_line = 2;

    // Return array of post IDs from CSV records
    return await parse(fs.readFileSync(filename), {
        from_line: from_line, // todo: If custom CSV file, first line might not be header and instead a post
        skip_empty_lines: true,
        comment: '#',
    }).map((record: string) => record[0]);
}

type Post = {
    data: {
        id: string,
        author: string,
        author_fullname: string,
        subreddit: string,
        permalink: string,
        created_utc: number,
        created: number,
        downvotes: number,
        upvotes: number,
        score: number,
        over_18: boolean,
        removed_by_category: string | null,
    };
    content: {
        title: string,
        selftext: string,
        thumbnail: string,
        domain: string,
        url: string,
    };
};

async function ReadFile(filename: string) {
    return fs.readFileSync(filename, 'utf8');
}

async function WriteFile(filename: string, data: string) {
    await new Writer(filename).write(data);
}

async function WritePostData(postDirectory: string, data: Post) {
    await WriteFile(postDirectory + '/post.json', JSON.stringify(data));
}

async function DownloadThumbnail(url: string, postDirectory: string) {
    const image = (await axios.get(url, { responseType: 'stream' })).data;
    await new Writer(postDirectory + '/thumbnail.jpg').write(image);
}

// Main (downloads start right after the progress bar displays, done so instead of using variables, the progress bar can be used to track progress)

function formatter(options: cliProgress.Options, params: cliProgress.Params, payload: any) {
    const remaining = params.total - params.value;
    options.format = chalk.blueBright('[{bar}]') + ' {percentage}% | {value}/{total} Posts | Remaining: ' + remaining + ' | ' + chalk.green('Downloaded: {downloaded}') + ' | ' + chalk.red('Failed: {failed}') + ' | ETA: {eta_formatted} | Elapsed: {duration_formatted}';
    return cliProgress.Format.Formatter(options, params, payload);
}

const multibar = new cliProgress.MultiBar({
    format: formatter,
    stopOnComplete: true,
    // barIncompleteChar: ' ',
    forceRedraw: true,
}, cliProgress.Presets.legacy);

const posts = await getLinks(input); // Get post IDs from CSV file
let postsFailed: string[] = []; // Track failed posts (including skipped posts)

const progress = multibar.create(posts.length, 0, {
    downloaded: 0, // successful downloads
    failed: 0, // failed downloads
    remaining: posts.length, // remaining posts
});

// Use readline to capture SIGINT on Windows
if (process.platform === "win32") {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.on('SIGINT', () => {
        process.emit('SIGINT');
    });
}
process.on('SIGINT', async () => {
    console.log('\n\nStopping script...');

    // todo: Gracefully shutdown (save progress to input file)
    // save remaining.json (stringify the posts array)
    // todo: remove duplicates from remaining.json
    // todo: remove post ID from posts array on each iteration (so it can track and be saved as remaining posts), maybe in the log function with:
    // const index = posts.indexOf(post);
    // posts.splice(posts.indexOf(post, 1));

    /* // Save remaining posts to file (including failed posts)
    const progressFile = options['output-directory'] + '/progress.json';
    let progressJSON;
    if (fs.existsSync(progressFile)) {
        progressJSON = JSON.parse(await ReadFile(progressFile)); // todo: handle errors
        progressJSON.remaining = progressJSON.remaining.concat(posts);
        progressJSON.failed = progressJSON.failed.concat(postsFailed);
    } else {
        progressJSON = {
            remaining: posts,
            failed: postsFailed,
        };
    }
    // Remove duplicates
    progressJSON.remaining = [...new Set(progressJSON.remaining)];
    progressJSON.failed = [...new Set(progressJSON.failed)];
    await WriteFile(progressFile, JSON.stringify(progressJSON)); */

    console.log(`\nDownloaded ${(progress as any).payload.downloaded}. Failed: ${(progress as any).payload.failed}. Total Completed: ${(progress as any).payload.downloaded + (progress as any).payload.failed}.`);
    process.exit(0);
});

// End progress bar and script
multibar.once('stop', async () => {
    // Get current post IDs in failed.csv (if it exists)
    const existingPostsFailed = fs.existsSync(options['output-directory'] + '/failed.csv') ? await getLinks(`${options['output-directory']}/failed.csv`) : [];

    // Merge existing posts with new failed posts (remove duplicates)
    postsFailed = [...new Set(existingPostsFailed.concat(postsFailed))];

    // Write failed posts to file
    await new Writer(`${options['output-directory']}/failed.csv`).write('id,permalink\n' + postsFailed.join('\n'));
    console.log(`---\n\nDownloads complete. [${new Date().toLocaleString()}].`);

    process.exit(0);
});

type ProgressPayload = {
    downloaded?: number,
    failed?: number,
};

// todo: Add ETA, use default formatter, but take into account Reddit's ratelimit of 60 requests per minute?
// multibar.log(`ratelimitExpiration: ${await reddit.ratelimitExpiration}\n`);
// multibar.log(`ratelimitRemaining: ${await reddit.ratelimitRemaining}\n`);
function updateProgress(payload: ProgressPayload) {
    progress.increment();
    progress.update(payload);
}

function log(id: string, message: string) {
    if (options['verbose']) multibar.log(`[${id}] ${message}. ${progress.getTotal() - ((progress as any).payload.downloaded + (progress as any).payload.failed)} remaining.\n`);
};
function downloaded(id: string) {
    updateProgress({ downloaded: (progress as any).payload.downloaded + 1 });
    log(id, 'Downloaded');
};
function failed(id: string) {
    updateProgress({ failed: (progress as any).payload.failed + 1 });
    log(id, 'Failed');
};
function skipped(id: string) {
    updateProgress({ failed: (progress as any).payload.failed + 1 });
    log(id, 'Skipped');
};

// Create output directory if it doesn't exist.
fs.mkdirSync(options['output-directory']!, { recursive: true }); // options['output-directory'] is guaranteed to be defined at this point (defaults to 'posts' if none given)

multibar.log('Starting downloads...\n\n---\n');

for (const id of posts) {
    // Defined here so they can be used outside of the try block
    let Post: Post;
    let submission: snoowrap.Submission;

    try {
        submission = reddit.getSubmission(id);

        // await keyword is required, contrary to what visual studio code reports
        Post = {
            data: {
                id: await submission.id,
                author: await submission.author.name,
                author_fullname: await submission.author_fullname,
                subreddit: await submission.subreddit_name_prefixed,
                permalink: await submission.permalink,
                created_utc: await submission.created_utc,
                created: await submission.created,
                downvotes: await submission.downs,
                upvotes: await submission.ups,
                score: await submission.score,
                over_18: await submission.over_18,
                removed_by_category: await submission.removed_by_category,
            },
            content: {
                title: await submission.title,
                selftext: await submission.selftext,
                thumbnail: await submission.thumbnail,
                domain: await submission.domain,
                url: await submission.url,
            }
        };
    } catch (error) {
        postsFailed.push(id + ',' + 'https://www.reddit.com/' + id);
        failed(id);
        continue; // Skip if post data could not be fetched
    }

    try {
        let postDirectory = options['output-directory'] + '/' + Post.data.subreddit + '/' + Post.data.id;

        // Skip deleted posts (or put in separate folder if option is set)
        // todo: Check the different possible values of Post.data.removed_by_category, and download the post if the post was removed in a way that doesn't affect the content, and skip if content was affected
        // if (Post.content.title === '[deleted by user]') {
        // Post.data.removed_by_category === 'deleted'
        if (Post.content.selftext === '[removed]') { // todo: Post content might be set to '[removed]' even if the post wasn't deleted (original text when posted)
            // Save post data in a separate folder (if option is set)
            if (options['save-deleted']) {
                postDirectory = options['output-directory'] + '/deleted/' + Post.data.subreddit + '/' + Post.data.id;
            } else {
                skipped(id);
                continue;
            }
        }

        // Skip NSFW posts (if option is set)
        if (options['nsfw-only']) {
            if (!Post.data.over_18) {
                skipped(id);
                continue;
            }
        }

        // Create post directory if it doesn't exist (at this point, posts that should be skipped, have already been)
        fs.mkdirSync(postDirectory, { recursive: true });

        // Write post data to file (if media-only is not set)
        if (!options['media-only']) await WritePostData(postDirectory, Post);

        // Download content
        if (!Post.content.thumbnail.includes('http')) {
            try { await DownloadThumbnail(Post.content.thumbnail, postDirectory); } catch (error) { } // ignore thumbnail if it fails, or if there is no link
        }
        exec(`gallery-dl "${Post.content.url}" -D "${postDirectory}/content"`); // uppercase D for exact directory (otherwise it creates a subdirectory under "gallery-dl", if lowercase d is used)
        downloaded(Post.data.id);
    } catch (error) {
        postsFailed.push(id + ',' + 'https://www.reddit.com' + Post.data.permalink); // no extra slash because permalink already has one
        failed(Post.data.id);
        continue; // Skip if post download failed
    }
}
