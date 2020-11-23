const fs = require('fs');
const readline = require('readline');
const xml2js = require('xml2js');

const DATA_LINE_REGEX = /((?:[0-9A-F]+ ?)+)\s+;(.+)\s+#.+E([0-9.]+) (.+)/;
const EMOJI_WITH_MODIFIER_REGEX = /([a-z]+): ([a-z -]+)/;
const EMOJI_WITH_SKIN_TONE_AND_MODIFIER_REGEX = /([a-z]+): ([a-z -]+), ([a-z ]+)/;

const categoryKeys = {
  'Smileys & Emotion': 'smileys',
  'People & Body': 'people',
  'Animals & Nature': 'animals',
  'Food & Drink': 'food',
  'Travel & Places': 'travel',
  'Activities': 'activities',
  'Objects': 'objects',
  'Symbols': 'symbols',
  'Flags': 'flags'
};

const BLACKLIST = [
  'light skin tone',
  'medium-light skin tone',
  'medium skin tone',
  'medium-dark skin tone',
  'dark skin tone',
  'red hair',
  'white hair',
  'curly hair',
  'bald'
];

const MODIFIER_SUBSTITUTIONS = {
  'bald': 'no hair'
};

const lang = process.argv[2] || 'en';

async function readAnnotations(emojiAnno, filename) {
	const xml = await fs.readFileSync(filename, 'utf8')
	const result = await xml2js.parseStringPromise(xml);
	if (!result.ldml || !result.ldml.annotations) throw('No annotations found.');

	const emojis = result.ldml.annotations[0].annotation;
	
	for (let i = 0; i < emojis.length; i++) {
		const emoji = emojis[i]

		const keywords = emoji._.split('|').map(e => e.trim()).join(',');
		const symbol = emoji.$.cp
		const type = emoji.$.type

		if (!emojiAnno[symbol]) emojiAnno[symbol]={};
		if (type === 'tts') {
			emojiAnno[symbol].tts=emoji._;
		}
		else {
			emojiAnno[symbol].keywords=keywords;
		}
	}	
}

async function main() {
	console.log('Generating data for \''+lang+'\'...');

	// Annotion XML files are downloaded from https://github.com/unicode-org/cldr/tree/release-37/common.
	
	const emojiAnno = [];
	await readAnnotations(emojiAnno, lang+'-annotations.r37.xml');
	await readAnnotations(emojiAnno, lang+'-derived.r37.xml');
	
	const stream = fs.createReadStream('emoji-test.txt');
	const interface = readline.createInterface(stream);

	let currentGroup;
	let currentSubgroup;
	let categoryIndex;

	const data = {
	  categories: [],
	  emoji: []
	};

	interface.on('line', line => {
	  if (line.startsWith('# group:')) {
		currentGroup = line.slice('# group: '.length);
		if (currentGroup !== 'Component') {
		  data.categories.push(categoryKeys[currentGroup]);
		  categoryIndex = data.categories.length - 1;
		}
	  } else if (line.startsWith('# subgroup:')) {
		currentSubgroup = line.slice('# subgroup: '.length);
	  } else if (!line.startsWith('#') && currentGroup !== 'Component') {
		const matcher = DATA_LINE_REGEX.exec(line);
		if (matcher) {
		  const sequence = matcher[1].trim();
		  const emoji = getEmoji(sequence);
		  let name = matcher[4];

		  let version = matcher[3];
		  if (version === '0.6' || version === '0.7') {
			version = '1.0';
		  }

		  if (currentSubgroup === 'person') {
			const modifierMatcher = EMOJI_WITH_MODIFIER_REGEX.exec(name);
			const skinToneMatcher = EMOJI_WITH_SKIN_TONE_AND_MODIFIER_REGEX.exec(name);
			if (skinToneMatcher) {
			  name = skinToneMatcher[1] + ' with ' + substituteModifier(skinToneMatcher[3]) + ': ' + skinToneMatcher[2];
			} else if (modifierMatcher) {
			  if (!modifierMatcher[2].includes('skin tone')) {
				name = modifierMatcher[1] + ' with ' + substituteModifier(modifierMatcher[2]);
			  }
			}
		  }

		  if (matcher[2].trim() !== 'unqualified') {
			data.emoji.push({ sequence, emoji, category: categoryIndex, name, variations: [], version });
		  }
		}
	  }
	});

	interface.on('close', () => {
	  stream.close();

	  let toDelete = [];

	  const emojisWithVariationSelector = data.emoji.filter(emoji => emoji.sequence.includes('FE0F'));
	  emojisWithVariationSelector.forEach(emoji => {
		const baseEmoji = data.emoji.find(e => e.sequence === emoji.sequence.replace(' FE0F', ''));
		toDelete.push(baseEmoji);
	  });

//	  console.log('Deleting '+toDelete.length+' sequences with variations.');
	  
	  data.emoji = data.emoji.filter(e => !toDelete.includes(e));
	  toDelete = [];

	  BLACKLIST.forEach(name => toDelete.push(data.emoji.find(e => e.name === name)));

	  const emojisWithVariations = data.emoji.filter(emoji => emoji.name.includes(':') && !emoji.name.startsWith('family'));
	  emojisWithVariations.forEach(emoji => {
		const baseName = emoji.name.split(':')[0];
		const baseEmoji = data.emoji.find(e => e.name === baseName);
		if (baseEmoji) {
	//      baseEmoji.variations.push(emoji.emoji);
		  toDelete.push(emoji);
		}
	  });

	  const cookieEmojis = data.emoji.filter(emoji => emoji.name.includes('cookie:'));
	  cookieEmojis.forEach(emoji => {
		const baseName = emoji.name.split(':')[0];
		const baseEmoji = data.emoji.find(e => e.name === baseName);
		if (baseEmoji) {
		  baseEmoji.variations.push({emoji:emoji.emoji, name:emoji.name});
		  toDelete.push(emoji);
		}
	  });

	  // Cleanup
	  data.emoji = data.emoji.filter(e => !toDelete.includes(e));

		// Find annotations.
		data.emoji.forEach(emoji => {
			const baseSequence = emoji.sequence.replace(/ FE0F/g, '');
			const baseEmoji = getEmoji(baseSequence);
			if (!emojiAnno[baseEmoji]) console.log('No annotation: '+emoji.name+' ('+baseSequence+')');
			if (lang==='en' && emojiAnno[baseEmoji].tts!==emoji.name) console.log('Annotation has different name: '+emoji.name+' vs. '+emojiAnno[baseEmoji].tts);
			if (emojiAnno[baseEmoji].tts) emoji.name=emojiAnno[baseEmoji].tts;
			var keywords=emojiAnno[baseEmoji].keywords;
			if (keywords) keywords+=',';
			keywords+=emojiAnno[baseEmoji].keywords;
			emoji.keywords=keywords;
		});

	  data.emoji.forEach(emoji => {
		delete emoji.sequence;
		delete emoji.version;		// version comparison code in emojiContainer.ts first tests for !(e as EmojiRecord).version
		if (!emoji.variations.length) {
		  delete emoji.variations;
		}
		
		// Tried using short field names emoji.e, emoji.n etc. That saved 37kB in the final bundle size.
		// However, Apache2 sends compressed data by default, and the redundant field names compress really
		// well, so there is no difference in the final transmit size! Thus we'll stick to the long and
		// descriptive field names.
//		emoji.e=emoji.emoji;
//		emoji.n=emoji.name;
//		emoji.c=emoji.category;
//		emoji.k=emoji.keywords;
//		delete emoji.emoji;
//		delete emoji.name;
//		delete emoji.category;
//		delete emoji.keywords;
	  });

	  fs.writeFileSync('src/data/emoji-node-'+lang+'.js', `export default ${JSON.stringify(data)}`);
	  fs.writeFileSync('src/data/emoji-plain-'+lang+'.js', `var emojiData_${lang}=${JSON.stringify(data)};`);
	});
}
main();
	
function getEmoji(sequence) {
  const chars = sequence.split(' ');
  const codePoints = chars.map(char => parseInt(char, 16));
  return String.fromCodePoint(...codePoints);
}

function substituteModifier(name) {
  const substitutions = Object.keys(MODIFIER_SUBSTITUTIONS);
  for (let i = 0; i < substitutions.length; i++) {
    const substitution = substitutions[i];
    if (name.includes(substitution)) {
      return name.replace(substitution, MODIFIER_SUBSTITUTIONS[substitution]);
    }
  }

  return name;
}