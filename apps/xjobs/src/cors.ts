export const CorseConfig = (domain: string) =>  new RegExp(
        String.raw`^https:\/\/([a-z0-9-]+\.)*${domain.replaceAll('.', '\\.')}$`,
        'i',
      )