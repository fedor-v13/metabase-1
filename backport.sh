git reset HEAD~1
rm ./backport.sh
git cherry-pick b4270a134719b17c68db0b9cd9b013db7489b094
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
