import snoowrap from 'snoowrap';
import { parse } from 'csv/sync';
import { Writer } from 'steno';
import axios from 'axios';
import dotenv from 'dotenv';

import fs from 'node:fs';
import os from 'node:os';
import { exec } from 'node:child_process';

import module from 'module';
const require = module.createRequire(import.meta.url);
const { version } = require('./package.json');

// Load .env file, or generate one if it doesn't exist
if (dotenv.config().error) {
    console.log('No .env file found.\nGenerating default config...');
    await new Writer('.env').write('REDDIT_USERNAME = ""\nREDDIT_CLIENT_ID = ""\nREDDIT_CLIENT_SECRET = ""\nREDDIT_REFRESH_TOKEN = ""\n').catch(
        () => {
            console.log('Failed to create default .env file.\nPlease create a .env file with the following environment variables: "REDDIT_USERNAME", "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_REFRESH_TOKEN".\n',);
        }
    );
    process.exit(1);
}

const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const REDDIT_APP_NAME = 'reddit-save';
const USER_AGENT = `${os.platform()}:${REDDIT_APP_NAME}:${version} (by /u/${REDDIT_USERNAME})`;

const reddit = new snoowrap({
    userAgent: USER_AGENT,
    clientId: REDDIT_CLIENT_ID,
    clientSecret: REDDIT_CLIENT_SECRET,
    username: REDDIT_USERNAME,
    refreshToken: REDDIT_REFRESH_TOKEN,
});

reddit.config({ continueAfterRatelimitError: true });

// const output_directory = 'posts_test';
const output_directory = 'posts';

(async function Main() {
    // await DownloadAll('test.csv');
    // await DownloadAll('posts/failed.csv');
    await DownloadAll('data/hidden_posts.csv');
})();

interface Post {
    data: {
        id: string,
        author: string,
        title: string,
        subreddit: string,
        permalink: string,
    };
    content: {
        thumbnail: string,
        domain: string,
        url: string,
    };
};

/**
 * GetLinks returns an array of post IDs from the given CSV file.
 * Comments (#) and empty lines are ignored.
 * It is assumed that the first column of the CSV file contains the post IDs,
 * and that the first line of the CSV file is a header.
 * @param filename - The CSV file to read from.
 */
async function GetLinks(filename: string): Promise<string> {
    // Get array of CSV records
    const records = await parse(fs.readFileSync(filename), {
        from_line: 2,
        skip_empty_lines: true,
        comment: '#',
    });

    // Return array of post IDs
    return records.map((record: string) => record[0]);
}

async function WritePostData(post_directory: string, data: Post) {
    await new Writer(post_directory + '/post.json').write(JSON.stringify(data));
}

async function DownloadThumbnail(url: string, post_directory: string) {
    const image = (await axios.get(url, { responseType: 'stream' })).data;
    await new Writer(post_directory + '/thumbnail.jpg').write(image);
}

/**
 * Downloads all post content from every Reddit post in the given CSV file.
 * It takes in a CSV filename directly, removing the need to call GetLinks.
 * @param filename - The CSV file to read from.
 */
async function DownloadAll(filename: string) {
    const failed: string[] = [];
    const posts = await GetLinks(filename);
    let remaining = posts.length;

    console.log('Starting downloads...\n\n---');

    for (const id of posts) {

        remaining--;

        let Post: Post;
        let submission: snoowrap.Submission;

        try {
            submission = reddit.getSubmission(id);
            // if (!submission.over_18) { continue; } // only download NSFW posts (in case you need this, it's here for you to uncomment)
            Post = {
                data: {
                    id: await submission.id,
                    author: await submission.author.name,
                    title: await submission.title,
                    subreddit: await submission.subreddit_name_prefixed,
                    permalink: await submission.permalink,
                },
                content: {
                    thumbnail: await submission.thumbnail,
                    domain: await submission.domain,
                    url: await submission.url,
                }
            };
        } catch (error) {
            failed.push(id + ',' + 'https://www.reddit.com/' + id);
            console.log(`[${id}] Failed. ${remaining} remaining.`);
            continue;
        }

        try {
            // Create post directory if it doesn't exist
            const post_directory = output_directory + '/' + Post.data.subreddit + '/' + Post.data.id;
            fs.mkdirSync(post_directory, { recursive: true });

            // Write post data to file
            await WritePostData(post_directory, Post);

            // Download content
            if (!Post.content.thumbnail.includes('http')) {
                try { await DownloadThumbnail(Post.content.thumbnail, post_directory); } catch (error) { } // ignore thumbnail if it fails, or if there is no link
            }
            await exec(`gallery-dl "${Post.content.url}" -D "${post_directory}"`); // uppercase D for exact directory
            console.log(`[${Post.data.id}] Downloaded. ${remaining} remaining.`);
        } catch (error) {
            failed.push(id + ',' + 'https://www.reddit.com' + Post.data.permalink); // no extra slash because permalink already has one
            console.log(`[${Post.data.id}] Failed. ${remaining} remaining.`);
            continue;
        }

    }
    // Write failed posts to file
    await new Writer(`${output_directory}/failed.csv`).write('id,permalink\n' + failed.join('\n'));

    console.log(`---\n\nDownloads complete. Failed posts: ${failed.length}`);
}
