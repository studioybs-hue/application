import { Linking } from "react-native";
import { LegalPageWrapper, H2, H3, P, Bold, Bullet, InfoBox } from "@/src/legal/LegalPageWrapper";
import { COMPANY } from "@/src/legal/companyInfo";
import { Text } from "react-native";
import { colors } from "@/src/theme";

export default function MentionsLegales() {
  return (
    <LegalPageWrapper
      title="Mentions légales"
      subtitle="Informations légales relatives à l'éditeur du service CINÉMARIÉS, conformément à la loi n° 2004-575 du 21 juin 2004 pour la Confiance dans l'Économie Numérique (LCEN)."
      lastUpdate={COMPANY.lastUpdate}
    >
      <H2>1. Éditeur du site</H2>
      <P>Le service <Bold>{COMPANY.brand}</Bold> ({COMPANY.appWebsite}) est édité par :</P>
      <Bullet><Bold>Raison sociale</Bold> : {COMPANY.legalName} ({COMPANY.sigle})</Bullet>
      <Bullet><Bold>Forme juridique</Bold> : {COMPANY.legalForm}</Bullet>
      <Bullet><Bold>Capital social</Bold> : {COMPANY.capital}</Bullet>
      <Bullet><Bold>Siège social</Bold> : {COMPANY.addressLine1}, {COMPANY.city}, {COMPANY.country}</Bullet>
      <Bullet><Bold>RCS</Bold> : {COMPANY.rcs}</Bullet>
      <Bullet><Bold>SIREN</Bold> : {COMPANY.siren}</Bullet>
      <Bullet><Bold>EUID</Bold> : {COMPANY.euid}</Bullet>
      <Bullet><Bold>N° TVA intracommunautaire</Bold> : {COMPANY.vatNumber}</Bullet>
      <Bullet><Bold>Code APE</Bold> : {COMPANY.apeCode} (Production audiovisuelle)</Bullet>
      <Bullet><Bold>Activité</Bold> : {COMPANY.activity}</Bullet>

      <H2>2. Directeur de la publication</H2>
      <P><Bold>{COMPANY.publicationDirector}</Bold>, en qualité de Président de {COMPANY.legalName}.</P>

      <H2>3. Contact</H2>
      <Bullet>
        <Bold>Email</Bold> :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL(`mailto:${COMPANY.email}`)}>
          {COMPANY.email}
        </Text>
      </Bullet>
      <Bullet>
        <Bold>Téléphone</Bold> :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL(`tel:${COMPANY.phoneRaw}`)}>
          {COMPANY.phone}
        </Text>
      </Bullet>
      <Bullet>
        <Bold>Site corporate</Bold> :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL(COMPANY.website)}>
          {COMPANY.website}
        </Text>
      </Bullet>

      <H2>4. Hébergeur</H2>
      <P>Le site et l'application sont hébergés par :</P>
      <Bullet><Bold>{COMPANY.host.name}</Bold></Bullet>
      <Bullet>Adresse : {COMPANY.host.address}, {COMPANY.host.country}</Bullet>
      <Bullet>Téléphone : {COMPANY.host.phone}</Bullet>
      <Bullet>
        Site web :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL(COMPANY.host.website)}>
          {COMPANY.host.website}
        </Text>
      </Bullet>

      <H2>5. Propriété intellectuelle</H2>
      <P>
        L'ensemble du site et de l'application {COMPANY.brand} (charte graphique, logos, marques, textes, illustrations, photographies, vidéos, codes sources et bases de données) est la propriété exclusive de {COMPANY.legalName} ou de ses partenaires, et est protégé par le droit d'auteur, le droit des marques et le droit des bases de données.
      </P>
      <P>
        <Bold>Films de mariage</Bold> : les vidéos diffusées via le service appartiennent à leurs clients respectifs (mariés). {COMPANY.legalName} dispose d'un droit de diffusion et de stockage conformément au contrat signé avec chaque client. Toute reproduction, téléchargement, captation, diffusion publique ou rediffusion non autorisée des films constitue une <Bold>contrefaçon</Bold> sanctionnée par les articles L.335-2 et suivants du Code de la propriété intellectuelle.
      </P>

      <H2>6. Crédits</H2>
      <Bullet>Conception &amp; développement : {COMPANY.legalName}</Bullet>
      <Bullet>Production audiovisuelle : {COMPANY.legalName}</Bullet>
      <Bullet>Paiements sécurisés : Stripe Payments Europe Ltd (Irlande)</Bullet>
      <Bullet>Diffusion vidéo : infrastructure dédiée IONOS (France)</Bullet>

      <H2>7. Médiation à la consommation</H2>
      <P>
        Conformément aux articles L.611-1 et suivants du Code de la consommation, en cas de litige le consommateur peut recourir gratuitement à un médiateur de la consommation. Avant toute saisine, merci d'adresser une réclamation écrite à <Bold>{COMPANY.email}</Bold>. À défaut de réponse satisfaisante sous 60 jours, le consommateur peut saisir la plateforme européenne de Règlement en Ligne des Litiges (RLL) :{" "}
        <Text style={{ color: colors.gold }} onPress={() => Linking.openURL("https://ec.europa.eu/consumers/odr")}>
          https://ec.europa.eu/consumers/odr
        </Text>
        .
      </P>

      <H2>8. Droit applicable</H2>
      <P>
        Les présentes mentions légales sont régies par le <Bold>droit français</Bold>. Tout litige relatif à leur interprétation ou exécution relève de la compétence exclusive des tribunaux du ressort de Paris, sauf disposition légale impérative contraire.
      </P>

      <InfoBox>
        Pour toute question juridique, contactez-nous à <Bold>{COMPANY.email}</Bold>.
      </InfoBox>
    </LegalPageWrapper>
  );
}
