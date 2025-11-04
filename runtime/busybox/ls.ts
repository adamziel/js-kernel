declare const processController: any;

const utilsModuleUrl = new URL('./lib/utils.ts', import.meta.url).href;

const createProgramSource = (): string => {
	const program = async function main(urls: {
		utilsModuleUrl: string;
	}): Promise<void> {
		const { errorToString, exitSafely, getArgv, writeStdout, writeStderr } =
			await import(/* @vite-ignore */ urls.utilsModuleUrl);

		try {
			const argv = getArgv();
			const targets = argv.length ? argv : ['.'];
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
							.map((entry) => {
								const stats = fs.statSync(
									`${target}/${entry}`
								) as unknown;
								return stats?.isDirectory()
									? `${entry}/`
									: String(entry);
							})
							.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
							.join(' ');
						writeStdout(names);
						if (targets.length > 1 && index < targets.length - 1) {
							writeStdout('\n');
						}
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
	})});`;
};

export const lsProgramSource = createProgramSource();
