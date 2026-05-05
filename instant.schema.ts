// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react-native";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    cardSets: i.entity({
      name: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    cards: i.entity({
      front: i.string(),
      back: i.string(),
      createdAt: i.number().indexed(),
    }),
  },
  rooms: {},
  links: {
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
    cardSetCards: {
      forward: {
        on: "cardSets",
        has: "many",
        label: "cards",
      },
      reverse: {
        on: "cards",
        has: "one",
        label: "cardSet",
      },
    },
  },
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
