/**
 * JS Tokenizer from https://github.com/szmarczak/js-tokenizer/. This is the first
 * library I found just to break through another wall in the process of getting the
 * Node.js loader to work.
 *
 * @TODO: Use a fast and small WASM-based tokenizer instead. Or find a way to answer
 *        questions about JS scripts without tokenizing them in JS.
 * @returns
 */
export const createTokenizer = () => {
	const isWhitespace = () => {
		switch (s.charAt(index)) {
			case ' ':
			case '\t':
			case '\n':
			case '\r':
				return true;
			default:
				return false;
		}
	};

	const consumeWhitespace = () => {
		while (isWhitespace()) {
			++index;
		}
	};

	const consumeNonWhitespace = () => {
		while (!isWhitespace() && index < s.length) {
			++index;
		}
	};

	const consumeNonWhitespaceNonPunctuator = () => {
		while (
			!isWhitespace() &&
			parsePunctuator() === undefined &&
			index < s.length
		) {
			++index;
		}
	};

	const consumeLine = () => {
		while (index < s.length) {
			const c = s.charAt(index);

			if (c === '\n' || c === '\r') {
				return;
			}

			++index;
		}
	};

	const isEscaped = () => {
		let escaped = false;
		let offset = 1;

		while (s.charAt(index - offset) === '\\') {
			escaped = !escaped;
			++offset;
		}

		return escaped;
	};

	const consumeStringSingle = () => {
		while ((s.charAt(index) !== "'" || isEscaped()) && index < s.length) {
			++index;
		}

		++index;
	};

	const consumeStringDouble = () => {
		while ((s.charAt(index) !== '"' || isEscaped()) && index < s.length) {
			++index;
		}

		++index;
	};

	const isRegularExpressionFlag = () => {
		switch (s.charAt(index)) {
			case 'd':
			case 'g':
			case 'i':
			case 'm':
			case 's':
			case 'u':
			case 'y':
				return true;
			default:
				return false;
		}
	};

	const consumeRegularExpression = () => {
		while ((s.charAt(index) !== '/' || isEscaped()) && index < s.length) {
			++index;
		}

		++index;

		while (isRegularExpressionFlag()) {
			++index;
		}
	};

	const isBinary = () => {
		switch (s.charAt(index)) {
			case '0':
			case '1':
				return true;
			default:
				return false;
		}
	};

	const isDigit = () => {
		switch (s.charAt(index)) {
			case '0':
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9':
				return true;
			default:
				return false;
		}
	};

	const isHex = () => {
		switch (s.charAt(index)) {
			case '0':
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9':
			case 'a':
			case 'b':
			case 'c':
			case 'd':
			case 'e':
			case 'f':
			case 'A':
			case 'B':
			case 'C':
			case 'D':
			case 'E':
			case 'F':
				return true;
			default:
				return false;
		}
	};

	const consumeDigits = () => {
		while (isDigit()) {
			++index;
		}
	};

	const consumeHex = () => {
		while (isHex()) {
			++index;
		}
	};

	const consumeBinary = () => {
		while (isBinary()) {
			++index;
		}
	};

	const consumeNumber = () => {
		const c = s.charAt(index);

		if (c === '0') {
			switch (s.charAt(index + 1)) {
				case 'b':
					index += 2;
					consumeBinary();
					return;
				case 'x':
					index += 2;
					consumeHex();
					return;
				default:
			}
		} else if (c === '.') {
			++index;

			if (!isDigit()) {
				--index;
				return;
			}
		} else if (!isDigit()) {
			return;
		}

		++index;

		while (true) {
			consumeDigits();

			switch (s.charAt(index)) {
				case '_':
					++index;
					continue;
				case 'e':
				case 'E':
					++index;

					const ec = s.charAt(index);

					if (ec === '+' || ec === '-') {
						++index;
					}

					consumeDigits();
					return;
				case 'n':
					++index;
					return;
				case '.':
					++index;
					continue;
				default:
					return;
			}
		}
	};

	const parsePunctuator = () => {
		switch (s.charAt(index)) {
			case '!':
				if (s.charAt(index + 1) === '=') {
					if (s.charAt(index + 2) === '=') {
						return '!==';
					}

					return '!=';
				}

				return '!';
			case '%':
				if (s.charAt(index + 1) === '=') {
					return '%=';
				}

				return '%';
			case '^':
				if (s.charAt(index + 1) === '=') {
					return '^=';
				}

				return '^';
			case '&':
				if (s.charAt(index + 1) === '&') {
					if (s.charAt(index + 2) === '=') {
						return '&&=';
					}

					return '&&';
				}

				if (s.charAt(index + 1) === '=') {
					return '&=';
				}

				return '&';
			case '*':
				if (s.charAt(index + 1) === '*') {
					if (s.charAt(index + 2) === '=') {
						return '**=';
					}

					return '**';
				}

				if (s.charAt(index + 1) === '=') {
					return '*=';
				}

				return '*';
			case '(':
				return '(';
			case ')':
				return ')';
			case '-':
				if (s.charAt(index + 1) === '-') {
					return '--';
				}

				if (s.charAt(index + 1) === '=') {
					return '-=';
				}

				return '-';
			case '=':
				if (s.charAt(index + 1) === '=') {
					if (s.charAt(index + 2) === '=') {
						return '===';
					}

					return '==';
				}

				if (s.charAt(index + 1) === '>') {
					return '=>';
				}

				return '=';
			case '+':
				if (s.charAt(index + 1) === '+') {
					return '++';
				}

				if (s.charAt(index + 1) === '=') {
					return '+=';
				}

				return '+';
			case '[':
				return '[';
			case ']':
				return ']';
			case '{':
				return '{';
			case '}':
				return '}';
			case '|':
				if (s.charAt(index + 1) === '|') {
					if (s.charAt(index + 2) === '=') {
						return '||=';
					}

					return '||';
				}

				if (s.charAt(index + 1) === '=') {
					return '|=';
				}

				return '|';
			case ';':
				return ';';
			case ':':
				return ':';
			case '~':
				return '~';
			case ',':
				return ',';
			case '.':
				if (
					s.charAt(index + 1) === '.' &&
					s.charAt(index + 2) === '.'
				) {
					return '...';
				}

				return '.';
			case '/':
				if (s.charAt(index + 1) === '=') {
					return '/=';
				}

				return '/';
			case '<':
				if (s.charAt(index + 1) === '<') {
					if (s.charAt(index + 2) === '=') {
						return '<<=';
					}

					return '<<';
				}

				if (s.charAt(index + 1) === '=') {
					return '<=';
				}

				return '<';
			case '>':
				if (s.charAt(index + 1) === '>') {
					if (s.charAt(index + 2) === '>') {
						if (s.charAt(index + 3) === '=') {
							return '>>>=';
						}

						return '>>>';
					}

					if (s.charAt(index + 2) === '=') {
						return '>>=';
					}

					return '>>';
				}

				if (s.charAt(index + 1) === '=') {
					return '>=';
				}

				return '>';
			case '?':
				if (s.charAt(index + 1) === '?') {
					if (s.charAt(index + 2) === '=') {
						return '??=';
					}

					return '??';
				}

				if (s.charAt(index + 1) === '.') {
					return '?.';
				}

				return '?';
		}
	};

	const maybeRegexAfter = (keyword) => {
		switch (keyword) {
			case 'await':
			case 'case':
			case 'delete':
			case 'in':
			case 'instanceof':
			case 'return':
			case 'throw':
			case 'typeof':
			case 'void':
			case 'yield':
			case '!':
			case '!==':
			case '%':
			case '%=':
			case '&':
			case '&=':
			case '&&':
			case '&&=':
			case '*':
			case '*=':
			case '**':
			case '**=':
			case '(':
			case '-':
			case '-=':
			case '=':
			case '==':
			case '===':
			case '=>':
			case '+':
			case '+=':
			case '[':
			case '{':
			case '}':
			case '|':
			case '|=':
			case '||':
			case '||=':
			case ';':
			case ':':
			case '~':
			case ',':
			case '...':
			case '/':
			case '/=':
			case '<':
			case '<=':
			case '<<':
			case '<<=':
			case '>':
			case '>=':
			case '>>':
			case '>>=':
			case '>>>':
			case '>>>=':
			case '?':
			case '??':
			case '??=':
			case 'TemplateHead':
			case 'TemplateMiddle':
				return true;
			default:
				return false;
		}
	};

	let s;
	let index;
	let level;
	let levels;
	let lastToken;
	let startIndex;

	const reset = () => {
		index = 0;
		level = 1;
		levels = 0;
		lastToken = ';';
	};

	function* tokenizer() {
		while (true) {
			consumeWhitespace();

			if (index >= s.length) {
				return;
			}

			switch (s.charAt(index)) {
				case '/':
					if (s.charAt(index + 1) === '/') {
						startIndex = index;
						consumeLine();

						yield [
							'SingleLineComment',
							startIndex,
							index,
							s.slice(startIndex, index),
						];
						continue;
					}

					if (s.charAt(index + 1) === '*') {
						startIndex = index;
						index = s.indexOf('*/', index);

						if (index === -1) {
							index = s.length;
						} else {
							index += 2;
						}

						yield [
							'MultiLineComment',
							startIndex,
							index,
							s.slice(startIndex, index),
						];
						continue;
					}

					if (maybeRegexAfter(lastToken)) {
						startIndex = index;
						++index;
						consumeRegularExpression();

						yield [
							'RegularExpressionLiteral',
							startIndex,
							index,
							s.slice(startIndex, index),
						];
					}
					break;
				case "'":
					startIndex = index;
					++index;
					consumeStringSingle();

					yield [
						'StringLiteral',
						startIndex,
						index,
						s.slice(startIndex, index),
					];

					lastToken = 'StringLiteral';

					continue;
				case '"':
					startIndex = index;
					++index;
					consumeStringDouble();

					yield [
						'StringLiteral',
						startIndex,
						index,
						s.slice(startIndex, index),
					];

					lastToken = 'StringLiteral';

					continue;
				case '`':
					startIndex = index;
					++index;

					while (index < s.length) {
						const canStop =
							s.charAt(index) === '`' ||
							(s.charAt(index) === '$' &&
								s.charAt(index + 1) === '{');

						if (!canStop || isEscaped()) {
							++index;
							continue;
						}

						if (s.charAt(index) === '`') {
							++index;

							yield [
								'NoSubstitutionTemplate',
								startIndex,
								index,
								s.slice(startIndex, index),
							];

							lastToken = 'NoSubstitutionTemplate';

							break;
						}

						++level;
						++levels;

						index += 2;
						yield [
							'TemplateHead',
							startIndex,
							index,
							s.slice(startIndex, index),
						];

						lastToken = 'TemplateHead';

						break;
					}

					continue;
				default:
			}

			startIndex = index;
			consumeNumber();
			if (index !== startIndex) {
				yield [
					'NumericLiteral',
					startIndex,
					index,
					s.slice(startIndex, index),
				];

				lastToken = 'NumericLiteral';

				continue;
			}

			const punctuator = parsePunctuator();
			if (punctuator !== undefined) {
				index += punctuator.length;

				lastToken = punctuator;

				if (levels !== 0) {
					if (punctuator === '{') {
						++level;
					} else if (punctuator === '}') {
						--level;

						if (level === levels) {
							--levels;

							startIndex = index - 1;

							while (index < s.length) {
								const canStop =
									s.charAt(index) === '`' ||
									(s.charAt(index) === '$' &&
										s.charAt(index + 1) === '{');

								if (!canStop || isEscaped()) {
									++index;
									continue;
								}

								if (s.charAt(index) === '`') {
									++index;

									yield [
										'TemplateTail',
										startIndex,
										index,
										s.slice(startIndex, index),
									];

									lastToken = 'TemplateTail';

									break;
								}

								++level;

								index += 2;
								yield [
									'TemplateMiddle',
									startIndex,
									index,
									s.slice(startIndex, index),
								];

								lastToken = 'TemplateMiddle';

								break;
							}

							continue;
						}
					}
				}

				yield ['Punctuator', startIndex, index, punctuator];

				continue;
			}

			const identifier =
				s.charAt(index) === '#'
					? 'PrivateIdentifier'
					: 'IdentifierName';

			startIndex = index;
			consumeNonWhitespaceNonPunctuator();
			const sliced = s.slice(startIndex, index);

			lastToken = sliced;

			yield [identifier, startIndex, index, sliced];
		}
	}

	return (code) => {
		s = String(code);

		reset();

		return tokenizer();
	};
};
