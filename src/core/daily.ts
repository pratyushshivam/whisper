/** Sentences to start from: a few to tap, and one a day that is the same for everyone. */

export const SUGGESTED = [
  "My dog ate seven socks and feels fine.",
  "The rocket will launch at sunrise.",
  "We are having pancakes for dinner on Friday.",
  "The meeting is moved to three o'clock tomorrow.",
  "Please water the plants while I am away.",
  "A penguin borrowed my blue umbrella.",
  "Grandpa won two medals at the dance contest.",
  "The library closes early because of snow.",
];

const DAILY = [
  "The baker saved the last warm bun for the postman.",
  "Three ducks crossed the road in a very straight line.",
  "Our teacher brought a telescope to class on Monday.",
  "The lighthouse keeper paints one window every spring.",
  "A small robot waters the tomatoes at six each morning.",
  "My aunt keeps forty spoons in a yellow suitcase.",
  "The train to the coast leaves ten minutes late today.",
  "Two astronauts shared one orange above the clouds.",
  "The old piano only plays well when it rains.",
  "Somebody left a green bicycle outside the bakery.",
  "The goalkeeper wore odd socks and saved every shot.",
  "A fox walked through the market before sunrise.",
  "The kite got stuck in the tallest tree in the park.",
  "Dinner is at eight and the soup is already hot.",
  "The museum will open a new room full of clocks.",
  "Five friends built a raft from twelve empty barrels.",
  "The snowman lost his hat on the first sunny day.",
  "An owl delivered the letter to the wrong chimney.",
  "The bus driver sings the same song every Tuesday.",
  "My sister taught the parrot to say good morning.",
  "The bridge is closed until the river calms down.",
  "A turtle won the race by half a step.",
  "The gardener found a silver key under the roses.",
  "We need two eggs, one lemon and a lot of patience.",
  "The moon looked close enough to touch last night.",
  "The captain counted nine whales before breakfast.",
  "Please return the red ladder to the house next door.",
  "The puppet show starts when the bell rings twice.",
  "A cloud shaped like a dragon floated over the school.",
  "The clock in the square is four minutes fast.",
  "Nobody remembered who brought the giant watermelon.",
];

/** Days since 1 January 2026, by the UTC calendar, so the whole world turns over together. */
export function dayNumber(now: Date = new Date()): number {
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(2026, 0, 1)) / 86400000);
}

export function dailySentence(now: Date = new Date()): string {
  const n = dayNumber(now);
  return DAILY[((n % DAILY.length) + DAILY.length) % DAILY.length]!;
}

export function dailyLabel(now: Date = new Date()): string {
  return now.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
