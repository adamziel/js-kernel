declare const processController: any;

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href;
const pathsModuleUrl = new URL('../util/paths.ts', import.meta.url).href;

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string;
		pathsModuleUrl: string;
	}): Promise<void> {
		const { errorToString, exitSafely, getArgv, writeStdout, writeStderr } =
			await import(/* @vite-ignore */ urls.utilsModuleUrl);
		const { resolvePath } = await import(
			/* @vite-ignore */ urls.pathsModuleUrl
		);

		try {
			const argv = getArgv();
			const cwd = processController.cwd();
			const targets = (argv.length ? argv : ['.']).map((path) => {
				return resolvePath(path, cwd);
			});
			const fs = processController.fsSync;
			let hadError = false;

			const reportError = (target: string, error: unknown) => {
				writeStderr(`ls: ${target}: ${errorToString(error)}`);
				hadError = true;
			};

			for (let index = 0; index < targets.length; index += 1) {
				const target = targets[index];
				try {
					const stats = fs.statSync(target);

					if (stats?.isDirectory()) {
						const entries = fs.readdirSync(target) as unknown[];
						if (targets.length > 1) {
							writeStdout(`${target}:`);
						}
						const names = entries
							.map((entry) => String(entry))
							.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
						for (const name of names) {
							writeStdout(name, { appendNewline: false });
							if (
								fs.statSync(`${target}/${name}`).isDirectory()
							) {
								writeStdout('/', { appendNewline: false });
							}
							if (names.length > 1 && index < names.length - 1) {
								writeStdout(' ', { appendNewline: false });
							}
						}
						if (targets.length > 1 && index < targets.length - 1) {
							writeStdout('\n');
						}
						writeStdout('\n');
					} else {
						writeStdout(target + '\n');
					}
				} catch (error) {
					reportError(target, error);
				}
			}

			exitSafely(hadError ? 1 : 0);
		} catch (error) {
			writeStderr(`ls: ${errorToString(error)}`);
			exitSafely(1);
		}
	};

	return `(${program.toString()})(${JSON.stringify({
		utilsModuleUrl,
		pathsModuleUrl,
	})});`;
};

export const lsProgramSource = createProgramSource();
