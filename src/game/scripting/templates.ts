import type { LanguageId } from './types.ts';

export interface Example {
  id: string;
  title: string;
  /** Skills the example needs in Guided mode (its syntax and functions). */
  skills: readonly string[];
  code: string;
}

const FIRST_PROGRAM = `# Hi! This is Seedling, your robot.
# A program is a list of commands. Seedling does them from top to bottom.
# Press Run (or Ctrl+Enter) and watch the robot.

go_to("scrap")    # walk to the nearest scrap pile
`;

const AUTOMATE = `# Automation: Seedling gathers scrap by itself, forever.
# Needs the Loops skill. Press Stop to end it.
while True:
    go_to("scrap")
    harvest()
    harvest()
    harvest()
    deposit()
`;

export const PYTHON_EXAMPLES: readonly Example[] = [
  { id: 'first', title: 'Lesson 1: first steps', skills: [], code: FIRST_PROGRAM },
  { id: 'forever', title: 'Automation: work forever', skills: ['loop'], code: AUTOMATE },
  {
    id: 'kit', title: 'Lesson 2: craft and research', skills: [], code: `# Lesson 2: craft and research
# Needs a Workbench and a Research Lab (build them from the Build menu),
# and a research project picked in the Research panel.

# Collect timber and scrap first: harvest them...
go_to("tree")
harvest()
go_to("scrap")
harvest()

# The Workbench turns 2 timber + 1 scrap into a research kit.
go_to("workbench")
put()               # put in everything the recipe uses
take("research_kit")  # waits until the kit is finished

# The Lab turns kits into research.
go_to("lab")
put("research_kit")
`,
  },
  {
    id: 'loops', title: 'Lesson 3: loops and functions', skills: ['loop', 'functions', 'counter', 'operators', 'sense'], code: `# Lesson 3: loops and functions
# Gather from the scrap pile until the robot is full,
# deliver the load, and repeat until the pile is empty.

def gather():
    while can_harvest() and not is_inventory_full():
        harvest()

trips = 0
while True:
    go_to("scrap")          # the nearest scrap pile
    if not can_harvest():
        print("The pile is empty.")
        break
    gather()
    deposit()
    trips += 1
    print(f"Trip {trips} done.")
`,
  },
  {
    id: 'explore', title: 'Lesson 4: for loops and conditions', skills: ['loop', 'counter', 'operators', 'sense', 'lists'], code: `# Lesson 4: for loops and conditions
# Walk a square and report what is next to the robot at each corner.

for direction in ["east", "south", "west", "north"]:
    for step in range(3):
        if not move(direction):
            print("Blocked going", direction)
            break
    x, y = get_position()
    kind = get_resource_type()
    if kind is None:
        print(f"({x}, {y}): nothing to harvest here")
    else:
        print(f"({x}, {y}): found {kind}!")
`,
  },
];

export const STARTER_CODE: Readonly<Record<LanguageId, string>> = {
  python: FIRST_PROGRAM,
  java: `// Java support is still being built: this program can't run yet.
// It shows how the same robot commands will look in Java.
public class Program {
    public static void main(String[] args) {
        goTo("scrap");
        harvest();
        deposit();
    }
}
`,
  typescript: `// TypeScript support is still being built: this program can't run yet.
// It shows how the same robot commands will look in TypeScript.
goTo("scrap");
harvest();
deposit();
`,
};

/** Python ideas the command palette teaches, unlocked with skills in Guided mode (see python/features.ts). */
export const CONCEPTS: readonly { title: string; skill?: string; doc: string; code: string }[] = [
  { title: 'print', doc: 'Show a message in the console. Text goes in quotes.', code: 'print("Hello, valley!")' },
  { title: '# comment', doc: 'A note for humans. The robot skips everything after #.', code: '# this is a note' },
  { title: 'variable', skill: 'counter', doc: 'A named box that remembers a value, so you can use it later.', code: 'trips = 0' },
  { title: 'arithmetic', skill: 'operators', doc: 'Calculate with + - * /. Here: add one to a counter.', code: 'trips = trips + 1' },
  { title: 'if / else', skill: 'sense', doc: 'Decide: run some lines only when something is true.', code: 'if is_inventory_full():\n    deposit()\nelse:\n    harvest()' },
  { title: 'while loop', skill: 'loop', doc: 'Repeat lines as long as something is true. while True repeats forever: real automation!', code: 'while True:\n    go_to("tree")\n    harvest()\n    deposit()' },
  { title: 'for loop', skill: 'loop', doc: 'Repeat lines a fixed number of times.', code: 'for i in range(3):\n    harvest()' },
  { title: 'list', skill: 'lists', doc: 'Many values in one, in order. Loop over them with for.', code: 'for place in ["tree", "scrap"]:\n    go_to(place)\n    harvest()' },
  { title: 'function', skill: 'functions', doc: 'Give a group of lines a name, then use it like a command.', code: 'def gather(place):\n    go_to(place)\n    harvest()\n\ngather("tree")' },
];
